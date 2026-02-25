# AWS Production Security Audit (Elastic Beanstalk + RDS)

This checklist is intended for `macro-tracker-prod` in `us-east-2`.

## 1) Identity and Access
- Require MFA for all IAM users.
- Remove long-lived IAM user access keys where possible.
- Ensure Elastic Beanstalk EC2 instance profile has least-privilege permissions.
- Confirm no wildcard (`*`) actions/resources in app IAM roles unless justified.

Commands:
```bash
aws iam generate-credential-report
aws iam get-credential-report --query 'Content' --output text | base64 --decode > credential-report.csv
aws iam list-roles --query 'Roles[?contains(RoleName, `elasticbeanstalk`) || contains(RoleName, `macro`)].RoleName' --output text
aws iam list-attached-role-policies --role-name <ROLE_NAME>
aws iam get-role-policy --role-name <ROLE_NAME> --policy-name <INLINE_POLICY_NAME>
```

## 2) Edge and Load Balancer
- Force HTTPS only (HTTP 80 redirects to 443).
- Use modern TLS policy on ALB listener (TLS 1.2+).
- Attach AWS WAF to ALB.

Commands:
```bash
ENV_NAME=macro-tracker-prod
REGION=us-east-2

aws elasticbeanstalk describe-environment-resources \
  --environment-name "$ENV_NAME" --region "$REGION" \
  --query 'EnvironmentResources.LoadBalancers[].Name' --output text

LB_ARN=$(aws elbv2 describe-load-balancers --region "$REGION" \
  --query "LoadBalancers[?contains(DNSName, 'macro-tracker')].LoadBalancerArn" --output text)

aws elbv2 describe-listeners --load-balancer-arn "$LB_ARN" --region "$REGION"
aws wafv2 get-web-acl-for-resource --resource-arn "$LB_ARN" --region "$REGION" --scope REGIONAL
```

## 3) Network Controls
- ALB security group: only `80/443` inbound from internet.
- EC2 security group: inbound only from ALB security group.
- RDS security group: inbound only from app/EB security group.
- RDS should not be publicly accessible.

Commands:
```bash
aws ec2 describe-security-groups --region "$REGION" \
  --query 'SecurityGroups[].{GroupId:GroupId,Name:GroupName,Ingress:IpPermissions}'

aws rds describe-db-instances --region "$REGION" \
  --query 'DBInstances[].{DB:DBInstanceIdentifier,Public:PubliclyAccessible,SGs:VpcSecurityGroups[].VpcSecurityGroupId}'
```

## 4) Database Hardening (RDS)
- Storage encryption enabled.
- Deletion protection enabled.
- Automated backups enabled and retention >= 7 days.
- Minor version auto-upgrade enabled.
- IAM DB auth enabled if applicable.

Commands:
```bash
aws rds describe-db-instances --region "$REGION" \
  --query 'DBInstances[].{DB:DBInstanceIdentifier,Encrypted:StorageEncrypted,DeletionProtection:DeletionProtection,BackupRetention:BackupRetentionPeriod,AutoMinorUpgrade:AutoMinorVersionUpgrade,IamAuth:IAMDatabaseAuthenticationEnabled}'
```

## 5) Logging, Detection, and Alerting
- CloudTrail enabled (multi-region, log file validation on, KMS-encrypted trail).
- GuardDuty enabled.
- Security Hub enabled.
- Access Analyzer enabled.
- Alarms for 4xx/5xx surge, high latency, EB health degradation, and RDS storage/CPU.

Commands:
```bash
aws cloudtrail describe-trails --region "$REGION"
aws guardduty list-detectors --region "$REGION"
aws securityhub get-enabled-standards --region "$REGION"
aws accessanalyzer list-analyzers --region "$REGION"
```

## 6) Secrets and Application Config
- Store runtime secrets in AWS Secrets Manager or SSM Parameter Store, not plaintext EB env vars.
- Rotate secrets (`SESSION_SECRET`, OAuth secret, OpenAI key, DB credentials).
- Keep `APP_BASE_URL` set to the production URL.
- Ensure app is started with `NODE_ENV=production`.

## 7) Patch and Runtime Hygiene
- Keep EB platform branch current with latest security patches.
- Apply OS/package updates via managed updates maintenance window.
- Enable IMDSv2 only.

Commands:
```bash
aws elasticbeanstalk describe-environments --application-name macro-tracker --region "$REGION" \
  --query 'Environments[].{Name:EnvironmentName,PlatformArn:PlatformArn,Status:Status,Health:Health}'
```

## 8) Immediate Priorities
1. Enforce HTTPS + modern TLS policy on ALB.
2. Lock security groups so DB is reachable only from app SG.
3. Enable WAF managed rules on ALB.
4. Enable Security Hub + GuardDuty + CloudTrail validation.
5. Move secrets into Secrets Manager/SSM and rotate current secrets.
