# BooksOnline AWS Deployment Guide

Complete step-by-step guide to deploy BooksOnline on AWS using ECS + RDS + ALB.

## Architecture

```
                    ┌─────────────────┐
                    │  ALB (HTTPS)    │
                    │ Load Balancer   │
                    └────────┬────────┘
                             │
                ┌────────────┼────────────┐
                │            │            │
         ┌──────▼────┐ ┌──────▼────┐ ┌──────▼────┐
         │  ECS Task │ │  ECS Task │ │  ECS Task │
         │BooksOnline│ │BooksOnline│ │BooksOnline│
         │(Fargate)  │ │(Fargate)  │ │(Fargate)  │
         └──────┬────┘ └──────┬────┘ └──────┬────┘
                │            │            │
                └────────────┼────────────┘
                             │
                    ┌────────▼────────┐
                    │  RDS PostgreSQL │
                    │   booksonline   │
                    └─────────────────┘
```

## Prerequisites

- AWS Account with appropriate permissions (EC2, ECS, RDS, ALB, CloudWatch, Secrets Manager, IAM, ECR)
- AWS CLI v2 installed and configured
- Docker installed locally
- Git and the project cloned locally
- `bun` installed locally
- Strong password generator (or `openssl rand -base64 32`)

## Step 1: Set Up Environment Variables

Create a file to store your AWS configuration and secrets:

```bash
# Save this as aws-deploy.env (DO NOT COMMIT THIS FILE)
export AWS_REGION="us-east-1"
export AWS_ACCOUNT_ID="YOUR_AWS_ACCOUNT_ID"
export APP_NAME="booksonline"
export ECR_REPOSITORY_NAME="booksonline"
export ECS_CLUSTER_NAME="booksonline-cluster"
export ECS_SERVICE_NAME="booksonline-service"
export ECS_TASK_FAMILY="booksonline"
export RDS_INSTANCE_ID="booksonline-db"
export RDS_DB_NAME="booksonline"
export RDS_MASTER_USERNAME="postgres"
export RDS_MASTER_PASSWORD="YOUR_STRONG_PASSWORD_HERE"
export JWT_SECRET=$(openssl rand -base64 32)
export ALB_NAME="booksonline-alb"
export TARGET_GROUP_NAME="booksonline-tg"
```

Load the environment:

```bash
source aws-deploy.env
```

## Step 2: Create RDS PostgreSQL Database

```bash
echo "Creating RDS PostgreSQL database..."

aws rds create-db-instance \
  --db-instance-identifier $RDS_INSTANCE_ID \
  --db-instance-class db.t4g.micro \
  --engine postgres \
  --engine-version 16.1 \
  --master-username $RDS_MASTER_USERNAME \
  --master-user-password "$RDS_MASTER_PASSWORD" \
  --allocated-storage 20 \
  --storage-type gp3 \
  --db-name $RDS_DB_NAME \
  --publicly-accessible false \
  --backup-retention-period 7 \
  --multi-az false \
  --enable-cloudwatch-logs-exports postgresql \
  --tags Key=Application,Value=BooksOnline Key=Environment,Value=production \
  --region $AWS_REGION

echo "Waiting for RDS instance to be available (this may take 5-10 minutes)..."
aws rds wait db-instance-available \
  --db-instance-identifier $RDS_INSTANCE_ID \
  --region $AWS_REGION

# Get the RDS endpoint
RDS_ENDPOINT=$(aws rds describe-db-instances \
  --db-instance-identifier $RDS_INSTANCE_ID \
  --query 'DBInstances[0].Endpoint.Address' \
  --output text \
  --region $AWS_REGION)

echo "RDS endpoint: $RDS_ENDPOINT"
echo "Save this for later: export RDS_ENDPOINT=$RDS_ENDPOINT"
```

## Step 3: Create ECR Repository

```bash
echo "Creating ECR repository..."

aws ecr create-repository \
  --repository-name $ECR_REPOSITORY_NAME \
  --region $AWS_REGION

# Get the repository URI
ECR_REPOSITORY_URI=$(aws ecr describe-repositories \
  --repository-names $ECR_REPOSITORY_NAME \
  --query 'repositories[0].repositoryUri' \
  --output text \
  --region $AWS_REGION)

echo "ECR repository created: $ECR_REPOSITORY_URI"
echo "Save this: export ECR_REPOSITORY_URI=$ECR_REPOSITORY_URI"
```

## Step 4: Build and Push Docker Image

### Create Dockerfile

If not already present, create `Dockerfile` at project root:

```dockerfile
# Use official Bun runtime image
FROM oven/bun:latest

WORKDIR /app

# Copy configuration files
COPY package.json bun.lock bunfig.toml tsconfig.json components.json ./

# Copy source code
COPY src ./src
COPY .kiro ./.kiro

# Install production dependencies only
RUN bun install --production

# Verify TypeScript compilation
RUN bunx tsc --noEmit

# Expose the port
EXPOSE 3000

# Health check (Bun HTTP health check)
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD bun --eval "const res = await fetch('http://localhost:3000/api/health'); if (!res.ok) throw new Error(res.statusText);"

# Start the server in production mode
CMD ["bun", "start"]
```

### Create .dockerignore

```
node_modules
.git
.gitignore
.env*
*.test.ts
.kiro/hooks
.kiro/workflows
.agents
.vscode
dist
build
store.sqlite
*.db
*.sqlite
```

### Build and Push

```bash
# Set AWS credentials for ECR
aws ecr get-login-password --region $AWS_REGION | \
  docker login --username AWS --password-stdin $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com

# Build the Docker image
echo "Building Docker image..."
docker build -t $ECR_REPOSITORY_NAME:latest .

# Tag the image for ECR
docker tag $ECR_REPOSITORY_NAME:latest $ECR_REPOSITORY_URI:latest
docker tag $ECR_REPOSITORY_NAME:latest $ECR_REPOSITORY_URI:$(date +%Y%m%d-%H%M%S)

# Push to ECR
echo "Pushing image to ECR (this may take 1-2 minutes)..."
docker push $ECR_REPOSITORY_URI:latest

echo "Docker image pushed successfully!"
```

## Step 5: Create IAM Role for ECS Task Execution

```bash
echo "Creating IAM role for ECS task execution..."

# Create trust policy document
cat > /tmp/ecs-trust-policy.json << 'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "ecs-tasks.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF

# Create the role
aws iam create-role \
  --role-name ecsTaskExecutionRole \
  --assume-role-policy-document file:///tmp/ecs-trust-policy.json

# Attach the managed policy
aws iam attach-role-policy \
  --role-name ecsTaskExecutionRole \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy

# Create inline policy for Secrets Manager access
cat > /tmp/secrets-policy.json << 'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue",
        "kms:Decrypt"
      ],
      "Resource": [
        "arn:aws:secretsmanager:*:*:secret:booksonline/*"
      ]
    }
  ]
}
EOF

aws iam put-role-policy \
  --role-name ecsTaskExecutionRole \
  --policy-name AllowSecretsAccess \
  --policy-document file:///tmp/secrets-policy.json

# Get the role ARN
EXECUTION_ROLE_ARN=$(aws iam get-role \
  --role-name ecsTaskExecutionRole \
  --query 'Role.Arn' \
  --output text)

echo "Execution role created: $EXECUTION_ROLE_ARN"
echo "Save this: export EXECUTION_ROLE_ARN=$EXECUTION_ROLE_ARN"
```

## Step 6: Store Secrets in AWS Secrets Manager

```bash
echo "Storing secrets in AWS Secrets Manager..."

# Store DATABASE_URL
DATABASE_URL="postgresql://${RDS_MASTER_USERNAME}:${RDS_MASTER_PASSWORD}@${RDS_ENDPOINT}:5432/${RDS_DB_NAME}"

aws secretsmanager create-secret \
  --name booksonline/db-url \
  --secret-string "$DATABASE_URL" \
  --region $AWS_REGION

# Store JWT_SECRET
aws secretsmanager create-secret \
  --name booksonline/jwt-secret \
  --secret-string "$JWT_SECRET" \
  --region $AWS_REGION

echo "Secrets stored successfully!"
echo "Database URL secret: booksonline/db-url"
echo "JWT Secret: booksonline/jwt-secret"
```

## Step 7: Create VPC and Security Groups

```bash
echo "Setting up VPC and security groups..."

# Get default VPC
DEFAULT_VPC=$(aws ec2 describe-vpcs \
  --filters "Name=isDefault,Values=true" \
  --query 'Vpcs[0].VpcId' \
  --output text \
  --region $AWS_REGION)

# Get subnets
SUBNETS=$(aws ec2 describe-subnets \
  --filters "Name=vpc-id,Values=$DEFAULT_VPC" \
  --query 'Subnets[0:2].SubnetId' \
  --output text \
  --region $AWS_REGION)

echo "Using VPC: $DEFAULT_VPC"
echo "Using subnets: $SUBNETS"

# Create security group for ALB
ALB_SG=$(aws ec2 create-security-group \
  --group-name booksonline-alb-sg \
  --description "Security group for BooksOnline ALB" \
  --vpc-id $DEFAULT_VPC \
  --region $AWS_REGION \
  --query 'GroupId' \
  --output text)

# Allow HTTP/HTTPS to ALB
aws ec2 authorize-security-group-ingress \
  --group-id $ALB_SG \
  --protocol tcp \
  --port 80 \
  --cidr 0.0.0.0/0 \
  --region $AWS_REGION

aws ec2 authorize-security-group-ingress \
  --group-id $ALB_SG \
  --protocol tcp \
  --port 443 \
  --cidr 0.0.0.0/0 \
  --region $AWS_REGION

# Create security group for ECS tasks
ECS_SG=$(aws ec2 create-security-group \
  --group-name booksonline-ecs-sg \
  --description "Security group for BooksOnline ECS tasks" \
  --vpc-id $DEFAULT_VPC \
  --region $AWS_REGION \
  --query 'GroupId' \
  --output text)

# Allow traffic from ALB to ECS
aws ec2 authorize-security-group-ingress \
  --group-id $ECS_SG \
  --protocol tcp \
  --port 3000 \
  --source-security-group-id $ALB_SG \
  --region $AWS_REGION

# Create security group for RDS
RDS_SG=$(aws ec2 create-security-group \
  --group-name booksonline-rds-sg \
  --description "Security group for BooksOnline RDS" \
  --vpc-id $DEFAULT_VPC \
  --region $AWS_REGION \
  --query 'GroupId' \
  --output text)

# Allow PostgreSQL from ECS
aws ec2 authorize-security-group-ingress \
  --group-id $RDS_SG \
  --protocol tcp \
  --port 5432 \
  --source-security-group-id $ECS_SG \
  --region $AWS_REGION

echo "Security groups created:"
echo "  ALB SG: $ALB_SG"
echo "  ECS SG: $ECS_SG"
echo "  RDS SG: $RDS_SG"
```

## Step 8: Create Application Load Balancer

```bash
echo "Creating Application Load Balancer..."

SUBNET_ARRAY=($SUBNETS)

ALB_ARN=$(aws elbv2 create-load-balancer \
  --name $ALB_NAME \
  --subnets $SUBNET_ARRAY \
  --security-groups $ALB_SG \
  --scheme internet-facing \
  --type application \
  --region $AWS_REGION \
  --query 'LoadBalancers[0].LoadBalancerArn' \
  --output text)

# Get ALB DNS name
ALB_DNS=$(aws elbv2 describe-load-balancers \
  --load-balancer-arns $ALB_ARN \
  --region $AWS_REGION \
  --query 'LoadBalancers[0].DNSName' \
  --output text)

echo "ALB created: $ALB_DNS"
echo "Save this: export ALB_ARN=$ALB_ARN"
echo "Save this: export ALB_DNS=$ALB_DNS"
```

## Step 9: Create Target Group and Health Check

```bash
echo "Creating target group..."

TG_ARN=$(aws elbv2 create-target-group \
  --name $TARGET_GROUP_NAME \
  --protocol HTTP \
  --port 3000 \
  --vpc-id $DEFAULT_VPC \
  --target-type ip \
  --health-check-protocol HTTP \
  --health-check-path /api/health \
  --health-check-interval-seconds 30 \
  --health-check-timeout-seconds 5 \
  --healthy-threshold-count 2 \
  --unhealthy-threshold-count 3 \
  --region $AWS_REGION \
  --query 'TargetGroups[0].TargetGroupArn' \
  --output text)

# Create listener
LISTENER_ARN=$(aws elbv2 create-listener \
  --load-balancer-arn $ALB_ARN \
  --protocol HTTP \
  --port 80 \
  --default-actions Type=forward,TargetGroupArn=$TG_ARN \
  --region $AWS_REGION \
  --query 'Listeners[0].ListenerArn' \
  --output text)

echo "Target group created: $TG_ARN"
echo "Save this: export TG_ARN=$TG_ARN"
```

## Step 10: Create ECS Cluster

```bash
echo "Creating ECS cluster..."

aws ecs create-cluster \
  --cluster-name $ECS_CLUSTER_NAME \
  --region $AWS_REGION

echo "ECS cluster created: $ECS_CLUSTER_NAME"
```

## Step 11: Register ECS Task Definition

Create `ecs-task-definition.json`:

```json
{
  "family": "booksonline",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "256",
  "memory": "512",
  "executionRoleArn": "arn:aws:iam::ACCOUNT_ID:role/ecsTaskExecutionRole",
  "containerDefinitions": [
    {
      "name": "booksonline",
      "image": "ACCOUNT_ID.dkr.ecr.REGION.amazonaws.com/booksonline:latest",
      "portMappings": [
        {
          "containerPort": 3000,
          "hostPort": 3000,
          "protocol": "tcp"
        }
      ],
      "environment": [
        {
          "name": "PORT",
          "value": "3000"
        },
        {
          "name": "NODE_ENV",
          "value": "production"
        }
      ],
      "secrets": [
        {
          "name": "DATABASE_URL",
          "valueFrom": "arn:aws:secretsmanager:REGION:ACCOUNT_ID:secret:booksonline/db-url"
        },
        {
          "name": "JWT_SECRET",
          "valueFrom": "arn:aws:secretsmanager:REGION:ACCOUNT_ID:secret:booksonline/jwt-secret"
        }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/booksonline",
          "awslogs-region": "REGION",
          "awslogs-stream-prefix": "ecs"
        }
      },
      "healthCheck": {
        "command": ["CMD-SHELL", "bun --eval \"const res = await fetch('http://localhost:3000/api/health'); if (!res.ok) throw new Error(res.statusText);\""],
        "interval": 30,
        "timeout": 5,
        "retries": 3,
        "startPeriod": 40
      }
    }
  ]
}
```

Replace placeholders and register:

```bash
# Update the JSON with actual values
sed -i "s/ACCOUNT_ID/$AWS_ACCOUNT_ID/g" ecs-task-definition.json
sed -i "s/REGION/$AWS_REGION/g" ecs-task-definition.json
sed -i "s|booksonline:latest|${ECR_REPOSITORY_URI}:latest|g" ecs-task-definition.json

# Register the task definition
TASK_DEFINITION_ARN=$(aws ecs register-task-definition \
  --cli-input-json file://ecs-task-definition.json \
  --region $AWS_REGION \
  --query 'taskDefinition.taskDefinitionArn' \
  --output text)

echo "Task definition registered: $TASK_DEFINITION_ARN"
```

## Step 12: Create CloudWatch Logs Group

```bash
echo "Creating CloudWatch Logs group..."

aws logs create-log-group \
  --log-group-name /ecs/booksonline \
  --region $AWS_REGION

# Set retention to 30 days
aws logs put-retention-policy \
  --log-group-name /ecs/booksonline \
  --retention-in-days 30 \
  --region $AWS_REGION

echo "CloudWatch Logs group created"
```

## Step 13: Create ECS Service

```bash
echo "Creating ECS service..."

# Get subnets as array
read -ra SUBNET_ARRAY <<< "$SUBNETS"

TASK_DEFINITION_REVISION=$(echo $TASK_DEFINITION_ARN | grep -oE '[0-9]+$')

aws ecs create-service \
  --cluster $ECS_CLUSTER_NAME \
  --service-name $ECS_SERVICE_NAME \
  --task-definition ${ECS_TASK_FAMILY}:${TASK_DEFINITION_REVISION} \
  --desired-count 2 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[${SUBNET_ARRAY[0]},${SUBNET_ARRAY[1]}],securityGroups=[$ECS_SG],assignPublicIp=ENABLED}" \
  --load-balancers "targetGroupArn=$TG_ARN,containerName=booksonline,containerPort=3000" \
  --region $AWS_REGION

echo "ECS service created: $ECS_SERVICE_NAME"
echo "Waiting for service to stabilize (this may take 2-3 minutes)..."

aws ecs wait services-stable \
  --cluster $ECS_CLUSTER_NAME \
  --services $ECS_SERVICE_NAME \
  --region $AWS_REGION

echo "Service is running!"
echo "Access your application at: http://$ALB_DNS"
```

## Step 14: Set Up Auto Scaling

```bash
echo "Setting up auto scaling..."

# Register scalable target
aws application-autoscaling register-scalable-target \
  --service-namespace ecs \
  --resource-id service/$ECS_CLUSTER_NAME/$ECS_SERVICE_NAME \
  --scalable-dimension ecs:service:DesiredCount \
  --min-capacity 2 \
  --max-capacity 10 \
  --region $AWS_REGION

# Create scaling policy (scale up when CPU > 70%)
aws application-autoscaling put-scaling-policy \
  --policy-name booksonline-cpu-scaling \
  --service-namespace ecs \
  --resource-id service/$ECS_CLUSTER_NAME/$ECS_SERVICE_NAME \
  --scalable-dimension ecs:service:DesiredCount \
  --policy-type TargetTrackingScaling \
  --target-tracking-scaling-policy-configuration "TargetValue=70.0,PredefinedMetricSpecification={PredefinedMetricType=ECSServiceAverageCPUUtilization},ScaleOutCooldown=60,ScaleInCooldown=300" \
  --region $AWS_REGION

echo "Auto scaling configured"
```

## Step 15: (Optional) Set Up HTTPS with ACM and CloudFront

For HTTPS, you'll need an SSL certificate:

```bash
# Request a certificate for your domain
aws acm request-certificate \
  --domain-name yourdomain.com \
  --subject-alternative-names "*.yourdomain.com" \
  --validation-method DNS \
  --region us-east-1

# Follow the verification steps in the console, then create a CloudFront distribution
# pointing to your ALB
```

## Verification and Testing

```bash
echo "Verifying deployment..."

# Check service status
aws ecs describe-services \
  --cluster $ECS_CLUSTER_NAME \
  --services $ECS_SERVICE_NAME \
  --region $AWS_REGION

# Test the health endpoint
curl http://$ALB_DNS/api/health

# Check logs
aws logs tail /ecs/booksonline --follow --region $AWS_REGION
```

## Cleanup (Destroy All Resources)

⚠️ **WARNING:** This will delete all resources. Only run if you want to tear down the deployment.

```bash
echo "Destroying all resources..."

# Delete ECS service
aws ecs delete-service \
  --cluster $ECS_CLUSTER_NAME \
  --service $ECS_SERVICE_NAME \
  --force \
  --region $AWS_REGION

# Delete ECS cluster
aws ecs delete-cluster \
  --cluster $ECS_CLUSTER_NAME \
  --region $AWS_REGION

# Delete ALB and target group
aws elbv2 delete-load-balancer \
  --load-balancer-arn $ALB_ARN \
  --region $AWS_REGION

aws elbv2 delete-target-group \
  --target-group-arn $TG_ARN \
  --region $AWS_REGION

# Delete RDS instance
aws rds delete-db-instance \
  --db-instance-identifier $RDS_INSTANCE_ID \
  --skip-final-snapshot \
  --region $AWS_REGION

# Delete security groups
aws ec2 delete-security-group --group-id $ALB_SG --region $AWS_REGION
aws ec2 delete-security-group --group-id $ECS_SG --region $AWS_REGION
aws ec2 delete-security-group --group-id $RDS_SG --region $AWS_REGION

# Delete ECR repository
aws ecr delete-repository \
  --repository-name $ECR_REPOSITORY_NAME \
  --force \
  --region $AWS_REGION

# Delete secrets
aws secretsmanager delete-secret \
  --secret-id booksonline/db-url \
  --force-delete-without-recovery \
  --region $AWS_REGION

aws secretsmanager delete-secret \
  --secret-id booksonline/jwt-secret \
  --force-delete-without-recovery \
  --region $AWS_REGION

# Delete IAM role
aws iam delete-role-policy \
  --role-name ecsTaskExecutionRole \
  --policy-name AllowSecretsAccess

aws iam detach-role-policy \
  --role-name ecsTaskExecutionRole \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy

aws iam delete-role --role-name ecsTaskExecutionRole

echo "All resources destroyed"
```

## Cost Estimation

**Monthly costs (approximate):**
- ECS Fargate: ~$15 (2 tasks, 512MB)
- RDS db.t4g.micro: ~$25
- ALB: ~$16
- Data transfer: ~$5-10
- **Total: ~$60-75/month**

## Monitoring and Maintenance

### View Logs
```bash
aws logs tail /ecs/booksonline --follow --region $AWS_REGION
```

### Monitor Task Health
```bash
aws ecs describe-services \
  --cluster $ECS_CLUSTER_NAME \
  --services $ECS_SERVICE_NAME \
  --region $AWS_REGION
```

### Scale Tasks Manually
```bash
aws ecs update-service \
  --cluster $ECS_CLUSTER_NAME \
  --service $ECS_SERVICE_NAME \
  --desired-count 4 \
  --region $AWS_REGION
```

## Troubleshooting

### Tasks not starting
1. Check logs: `aws logs tail /ecs/booksonline --follow`
2. Verify security group allows traffic between ALB and ECS
3. Ensure DATABASE_URL and JWT_SECRET are set correctly in Secrets Manager

### ALB health checks failing
1. Verify `/api/health` endpoint is working: `curl http://localhost:3000/api/health`
2. Check health check interval is appropriate (30 seconds default)
3. Verify security group allows port 3000 from ALB SG to ECS SG

### Database connection errors
1. Verify DATABASE_URL is correct
2. Ensure RDS security group allows inbound 5432 from ECS SG
3. Check RDS is in the same VPC as ECS tasks

## Additional Resources

- [AWS ECS Documentation](https://docs.aws.amazon.com/ecs/)
- [AWS RDS PostgreSQL](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_PostgreSQL.html)
- [Bun Deployment Guide](https://bun.sh/guides/ecosystem/docker)
- [ElysiaJS Deployment](https://elysiajs.com/at-glance.html)

