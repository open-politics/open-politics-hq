# Backup and Disaster Recovery System

## Overview

This document outlines the comprehensive backup system implemented to protect against data loss and enable disaster recovery. The system provides multiple layers of backup protection at different granularities.

## Backup Types and Capabilities

### 1. Infospace Backups (User-Level)
**Purpose**: Individual workspace protection and migration  
**Who Can Create**: Users for their own infospaces, Admins for any infospace  
**Scope**: Single infospace with all related data

#### Contents:
- All assets and their files
- All annotation schemas
- All annotation runs and their annotations
- All justifications and supporting data
- Datasets associated with the infospace
- Infospace metadata and settings

#### Use Cases:
- Before major changes to an infospace
- Sharing infospaces between users
- Moving infospaces between instances
- Creating snapshots for experimentation

#### API Access:
```bash
# Create infospace backup
POST /api/v1/infospaces/{infospace_id}/backups
{
  "name": "Pre-migration backup",
  "description": "Backup before moving to production",
  "backup_type": "manual"
}

# List user's infospace backups
GET /api/v1/infospaces/{infospace_id}/backups

# Restore infospace backup
POST /api/v1/backups/{backup_id}/restore
{
  "new_name": "Restored Workspace"
}
```

### 2. User Backups (System-Level)
**Purpose**: Complete user account protection and disaster recovery  
**Who Can Create**: Admins only  
**Scope**: Complete user account with all infospaces

#### Contents:
- User account information (email, settings, permissions)
- ALL infospaces owned by the user
- All assets, annotations, schemas, runs across all infospaces
- User-specific configurations and preferences
- Cross-infospace relationships and dependencies

#### Use Cases:
- Disaster recovery after database loss
- User migration between instances
- Comprehensive user data protection
- Compliance and audit requirements

#### API Access:
```bash
# Create user backup
POST /api/v1/user-backups
{
  "target_user_id": 123,
  "name": "Complete User Backup - john@example.com",
  "description": "Full backup before system migration"
}

# List all user backups
GET /api/v1/user-backups?target_user_id=123

# Restore user backup
POST /api/v1/user-backups/{backup_id}/restore
{
  "target_user_email": "john@example.com",
  "conflict_strategy": "smart"
}
```

### 3. System Backups (Automated)
**Purpose**: Complete system protection against catastrophic failure  
**Who Can Create**: System (automated) or Admins manually  
**Scope**: All users and all data in the system

#### Automated Schedule:
- **Weekly Full System Backup**: Every Sunday at 2 AM
- **Daily Cleanup**: Remove expired backups daily
- **Retention**: Configurable retention periods

#### Manual Triggers:
```bash
# Backup all users
POST /api/v1/user-backups/admin/backup-all
{
  "backup_type": "system"
}

# Backup specific users
POST /api/v1/user-backups/admin/backup-specific
{
  "user_ids": [1, 2, 3],
  "backup_type": "manual"
}
```

## Disaster Recovery Procedures

### Scenario 1: Complete Database Loss

If the entire database is accidentally deleted or corrupted:

#### Step 1: Recreate Database Schema
```bash
# Start the system (database will be empty)
docker-compose up -d postgres redis minio

# Apply database migrations
docker-compose exec backend alembic upgrade head
```

#### Step 2: Initialize System with Admin User
```bash
# Create initial admin user and basic data
docker-compose exec backend python -c "
from app.core.init_db import init_db
from app.core.db import engine
from sqlmodel import Session
with Session(engine) as session:
    init_db(session)
"
```

#### Step 3: Restore Users from System Backups
```bash
# Get admin authentication token
curl -X POST "http://localhost:8022/api/v1/login/access-token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=admin@example.com&password=admin_password"

# List available user backups (check MinIO/S3 storage)
curl -X GET "http://localhost:8022/api/v1/user-backups/admin/users-overview" \
  -H "Authorization: Bearer {admin_token}"

# Restore each user from their latest backup
curl -X POST "http://localhost:8022/api/v1/user-backups/{backup_id}/restore" \
  -H "Authorization: Bearer {admin_token}" \
  -H "Content-Type: application/json" \
  -d '{
    "backup_id": 123,
    "conflict_strategy": "overwrite"
  }'
```

#### Step 4: Verify Restoration
- Check that all users can log in
- Verify all infospaces are accessible
- Confirm all assets and annotations are present
- Test core functionality

### Scenario 2: Single User Data Loss

If a specific user's data is corrupted or accidentally deleted:

#### Step 1: Identify Latest User Backup
```bash
# Find user backups
curl -X GET "http://localhost:8022/api/v1/user-backups?target_user_id=123" \
  -H "Authorization: Bearer {admin_token}"
```

#### Step 2: Restore User
```bash
# Restore from backup
curl -X POST "http://localhost:8022/api/v1/user-backups/{backup_id}/restore" \
  -H "Authorization: Bearer {admin_token}" \
  -H "Content-Type: application/json" \
  -d '{
    "target_user_email": "user@example.com",
    "conflict_strategy": "smart"
  }'
```

### Scenario 3: Single Infospace Data Loss

If a specific infospace is corrupted:

#### Step 1: Find Infospace Backup
```bash
# List backups for the infospace
curl -X GET "http://localhost:8022/api/v1/infospaces/{infospace_id}/backups" \
  -H "Authorization: Bearer {user_token}"
```

#### Step 2: Restore Infospace
```bash
# Restore from backup
curl -X POST "http://localhost:8022/api/v1/backups/{backup_id}/restore" \
  -H "Authorization: Bearer {user_token}" \
  -H "Content-Type: application/json" \
  -d '{
    "new_name": "Restored Workspace"
  }'
```

## Backup Storage and Management

### Storage Location
- **Development**: Local MinIO instance
- **Production**: AWS S3 or compatible object storage
- **Path Structure**: 
  - Infospace backups: `infospace_backups/{infospace_id}/`
  - User backups: `user_backups/{user_id}/`

### Retention Policies
- **Infospace Backups**: User-configurable expiration
- **User Backups**: Default 90-day retention for manual, 30-day for automated
- **System Backups**: Keep last 4 weekly backups

### File Formats
- **Package Format**: ZIP files with structured JSON metadata
- **Compression**: Efficient compression for large assets
- **Integrity**: SHA-256 checksums for corruption detection

## Admin Interface Features

### Infospace Backup Management
Available at `/accounts/admin/backups`:

- **Overview Dashboard**: See all infospaces and their backup status
- **Search and Filter**: Find infospaces by name or owner
- **Bulk Operations**: Backup multiple infospaces at once
- **Individual Restore**: Restore any infospace backup

### User Backup Management
Available at `/accounts/admin/user-backups` (to be implemented):

- **User Overview**: See all users and their backup status
- **Bulk User Backup**: Backup all users or selected users
- **User Restoration**: Restore complete user accounts
- **Backup Monitoring**: Track backup progress and status

## Monitoring and Alerts

### Backup Health Monitoring
- **Failed Backup Alerts**: Notify admins of backup failures
- **Storage Space Monitoring**: Alert when backup storage is full
- **Retention Compliance**: Ensure backups meet retention requirements

### Recovery Testing
- **Regular Recovery Drills**: Periodic testing of backup restoration
- **Integrity Verification**: Regular validation of backup files
- **Performance Monitoring**: Track backup and restore performance

## Best Practices

### For Users
1. **Regular Backups**: Create infospace backups before major changes
2. **Descriptive Names**: Use clear, descriptive backup names
3. **Test Restores**: Periodically test restoring from backups
4. **Clean Up**: Remove old, unnecessary backups

### For Administrators
1. **Monitor System Backups**: Ensure automated backups are running
2. **Storage Management**: Monitor and manage backup storage usage
3. **Security**: Secure backup storage with proper access controls
4. **Documentation**: Keep disaster recovery procedures up to date

### For System Operations
1. **Automated Monitoring**: Set up alerts for backup failures
2. **Regular Testing**: Test disaster recovery procedures regularly
3. **Storage Redundancy**: Use redundant storage for critical backups
4. **Access Control**: Limit backup access to authorized personnel

## Security Considerations

### Access Control
- **Infospace Backups**: Users can only backup/restore their own infospaces
- **User Backups**: Only admins can create and restore user backups
- **System Backups**: Only superusers can trigger system-wide operations

### Data Protection
- **Encryption**: Backups stored with encryption at rest
- **Access Logging**: All backup operations are logged and audited
- **Secure Transfer**: HTTPS/TLS for all backup transfers
- **Token-Based Access**: Secure sharing via time-limited tokens

### Compliance
- **Audit Trail**: Complete audit trail of all backup operations
- **Data Retention**: Configurable retention to meet compliance requirements
- **Privacy Protection**: Ability to exclude sensitive data from backups

## Troubleshooting

### Common Issues

#### Backup Creation Fails
- Check storage provider connectivity
- Verify sufficient storage space
- Check user permissions
- Review Celery task logs

#### Restore Fails
- Verify backup file integrity
- Check target permissions
- Review conflict resolution strategy
- Check for dependency issues

#### Performance Issues
- Monitor storage provider performance
- Check for large asset files
- Review compression settings
- Consider parallel processing

### Error Resolution
- **Storage Errors**: Check MinIO/S3 connectivity and credentials
- **Permission Errors**: Verify user access to source and target resources
- **Timeout Errors**: Increase timeout settings for large backups
- **Corruption Errors**: Use backup checksums to verify integrity

## API Reference Summary

### Infospace Backups
- `POST /api/v1/infospaces/{id}/backups` - Create backup
- `GET /api/v1/infospaces/{id}/backups` - List backups
- `GET /api/v1/backups/{id}` - Get backup details
- `POST /api/v1/backups/{id}/restore` - Restore backup
- `DELETE /api/v1/backups/{id}` - Delete backup

### User Backups (Admin Only)
- `POST /api/v1/user-backups` - Create user backup
- `GET /api/v1/user-backups` - List user backups
- `POST /api/v1/user-backups/{id}/restore` - Restore user
- `GET /api/v1/user-backups/admin/users-overview` - Users overview
- `POST /api/v1/user-backups/admin/backup-all` - Backup all users

### System Operations
- `POST /api/v1/backups/cleanup` - Manual cleanup
- `POST /api/v1/user-backups/cleanup` - User backup cleanup

This comprehensive backup system ensures that your data is protected at multiple levels and can be recovered in various disaster scenarios, from individual infospace corruption to complete database loss. 