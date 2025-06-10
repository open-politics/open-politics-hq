#!/usr/bin/env python3
"""
Backup script for Open Politics application.
This script creates a backup of all user data and content from the database,
excluding S3/MinIO storage which is backed up separately.
"""

import os
import sys
import logging
import argparse
import subprocess
import datetime
import json
import shutil
from pathlib import Path
from typing import Dict, Any, List, Optional

# Add the parent directory to the path so we can import app modules
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.core.config import settings
from app.models import (
    User, Workspace, Document, AnnotationSchema, AnnotationField,
    Annotation, SavedResultSet, File, SearchHistory
)
from sqlmodel import Session, select, create_engine

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

def parse_args():
    """Parse command line arguments."""
    parser = argparse.ArgumentParser(description="Backup Open Politics user data")
    parser.add_argument(
        "--output-dir", 
        type=str, 
        default="./backups",
        help="Directory to store backup files (default: ./backups)"
    )
    parser.add_argument(
        "--pg-dump", 
        action="store_true",
        help="Use pg_dump for database backup (requires pg_dump to be installed)"
    )
    parser.add_argument(
        "--format", 
        type=str, 
        choices=["json", "sql", "custom"], 
        default="custom",
        help="Backup format (default: custom). Only applies when using pg_dump."
    )
    
    # Remote storage options
    remote_group = parser.add_argument_group('Remote Storage Options')
    remote_group.add_argument(
        "--upload",
        action="store_true",
        help="Upload backup to remote storage"
    )
    remote_group.add_argument(
        "--upload-method",
        type=str,
        choices=["s3", "sftp", "scp", "rsync", "nfs"],
        default="s3",
        help="Method to use for uploading backup (default: s3)"
    )
    remote_group.add_argument(
        "--remote-path",
        type=str,
        help="Remote path or bucket for backup storage"
    )
    remote_group.add_argument(
        "--remote-host",
        type=str,
        help="Remote host for SFTP/SCP/rsync uploads"
    )
    remote_group.add_argument(
        "--remote-user",
        type=str,
        help="Remote username for SFTP/SCP/rsync uploads"
    )
    remote_group.add_argument(
        "--remote-key",
        type=str,
        help="Path to SSH key for SFTP/SCP/rsync uploads"
    )
    remote_group.add_argument(
        "--compress",
        action="store_true",
        help="Compress backup before uploading"
    )
    remote_group.add_argument(
        "--retention-days",
        type=int,
        default=30,
        help="Number of days to retain backups on remote storage (default: 30)"
    )
    
    return parser.parse_args()

def ensure_backup_dir(backup_dir: str) -> str:
    """Ensure the backup directory exists and return the path."""
    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_path = os.path.join(backup_dir, f"backup_{timestamp}")
    os.makedirs(backup_path, exist_ok=True)
    logger.info(f"Created backup directory: {backup_path}")
    return backup_path

def pg_dump_backup(backup_path: str, format_type: str) -> bool:
    """
    Create a backup using pg_dump.
    
    Args:
        backup_path: Path to store the backup
        format_type: Format type (json, sql, custom)
    
    Returns:
        bool: True if successful, False otherwise
    """
    format_flag = {
        "json": "--format=plain --file={}.json",
        "sql": "--format=plain --file={}.sql",
        "custom": "--format=custom --file={}.dump"
    }[format_type]
    
    output_file = os.path.join(backup_path, "database")
    format_arg = format_flag.format(output_file)
    
    cmd = [
        "pg_dump",
        f"--host={settings.POSTGRES_SERVER}",
        f"--port={settings.POSTGRES_PORT}",
        f"--username={settings.POSTGRES_USER}",
        f"--dbname={settings.POSTGRES_DB}",
        *format_arg.split()
    ]
    
    # Set PGPASSWORD environment variable for pg_dump
    env = os.environ.copy()
    env["PGPASSWORD"] = settings.POSTGRES_PASSWORD
    
    try:
        logger.info(f"Running pg_dump: {' '.join(cmd)}")
        result = subprocess.run(cmd, env=env, check=True, capture_output=True)
        logger.info(f"pg_dump completed successfully")
        return True
    except subprocess.CalledProcessError as e:
        logger.error(f"pg_dump failed: {e}")
        logger.error(f"stdout: {e.stdout.decode()}")
        logger.error(f"stderr: {e.stderr.decode()}")
        return False

def export_table_data(session: Session, model, backup_path: str, filename: str) -> None:
    """Export data from a table to a JSON file."""
    logger.info(f"Exporting {filename}...")
    
    # Query all records from the table
    results = session.exec(select(model)).all()
    
    # Convert SQLModel objects to dictionaries
    data = [item.model_dump() for item in results]
    
    # Save to JSON file
    output_file = os.path.join(backup_path, f"{filename}.json")
    with open(output_file, "w") as f:
        json.dump(data, f, default=str, indent=2)
    
    logger.info(f"Exported {len(data)} records to {output_file}")

def manual_backup(backup_path: str) -> bool:
    """
    Create a backup by exporting each table to a JSON file.
    
    Args:
        backup_path: Path to store the backup files
    
    Returns:
        bool: True if successful, False otherwise
    """
    try:
        # Create database engine and session
        engine = create_engine(str(settings.SQLALCHEMY_DATABASE_URI))
        with Session(engine) as session:
            # Export each table
            export_table_data(session, User, backup_path, "users")
            export_table_data(session, Workspace, backup_path, "workspaces")
            export_table_data(session, Document, backup_path, "documents")
            export_table_data(session, File, backup_path, "files")
            export_table_data(session, AnnotationSchema, backup_path, "annotation_schemas")
            export_table_data(session, AnnotationField, backup_path, "annotation_fields")
            export_table_data(session, Annotation, backup_path, "annotations")
            export_table_data(session, SavedResultSet, backup_path, "saved_result_sets")
            export_table_data(session, SearchHistory, backup_path, "search_histories")
        
        # Create a metadata file with backup information
        metadata = {
            "backup_date": datetime.datetime.now().isoformat(),
            "database": settings.POSTGRES_DB,
            "tables_included": [
                "users", "workspaces", "documents", "files",
                "annotation_schemas", "annotation_fields",
                "annotations", "saved_result_sets",
                "search_histories"
            ],
            "excluded": ["S3/MinIO storage"]
        }
        
        with open(os.path.join(backup_path, "metadata.json"), "w") as f:
            json.dump(metadata, f, indent=2)
        
        logger.info(f"Backup completed successfully")
        return True
    except Exception as e:
        logger.error(f"Backup failed: {e}")
        return False

def compress_backup(backup_path: str) -> str:
    """
    Compress the backup directory into a tarball.
    
    Args:
        backup_path: Path to the backup directory
    
    Returns:
        str: Path to the compressed file
    """
    backup_dir = os.path.dirname(backup_path)
    backup_name = os.path.basename(backup_path)
    compressed_file = os.path.join(backup_dir, f"{backup_name}.tar.gz")
    
    try:
        logger.info(f"Compressing backup to {compressed_file}")
        cmd = ["tar", "-czf", compressed_file, "-C", backup_dir, backup_name]
        subprocess.run(cmd, check=True, capture_output=True)
        logger.info(f"Compression completed successfully")
        return compressed_file
    except subprocess.CalledProcessError as e:
        logger.error(f"Compression failed: {e}")
        logger.error(f"stdout: {e.stdout.decode()}")
        logger.error(f"stderr: {e.stderr.decode()}")
        return backup_path

def upload_to_s3(source_path: str, bucket: str, retention_days: int = 30) -> bool:
    """
    Upload backup to S3/MinIO.
    
    Args:
        source_path: Path to the backup file or directory
        bucket: S3 bucket name
        retention_days: Number of days to retain backups
    
    Returns:
        bool: True if successful, False otherwise
    """
    try:
        from minio import Minio
        from minio.error import S3Error
        
        # Create MinIO client
        client = Minio(
            endpoint=settings.MINIO_ENDPOINT,
            access_key=settings.MINIO_ROOT_USER,
            secret_key=settings.MINIO_ROOT_PASSWORD,
            secure=settings.MINIO_SECURE,
        )
        
        # Ensure bucket exists
        if not client.bucket_exists(bucket):
            client.make_bucket(bucket)
            logger.info(f"Created bucket: {bucket}")
        
        # If source is a directory, upload each file
        if os.path.isdir(source_path):
            for root, _, files in os.walk(source_path):
                for file in files:
                    file_path = os.path.join(root, file)
                    object_name = os.path.relpath(file_path, os.path.dirname(source_path))
                    
                    # Upload file
                    client.fput_object(
                        bucket_name=bucket,
                        object_name=object_name,
                        file_path=file_path,
                    )
                    logger.info(f"Uploaded {file_path} to {bucket}/{object_name}")
        else:
            # Upload single file
            object_name = os.path.basename(source_path)
            client.fput_object(
                bucket_name=bucket,
                object_name=object_name,
                file_path=source_path,
            )
            logger.info(f"Uploaded {source_path} to {bucket}/{object_name}")
        
        # Clean up old backups if retention_days is specified
        if retention_days > 0:
            cutoff_date = datetime.datetime.now() - datetime.timedelta(days=retention_days)
            objects = client.list_objects(bucket)
            
            for obj in objects:
                # Parse date from object name (assuming backup_YYYYMMDD_HHMMSS format)
                try:
                    if obj.object_name.startswith("backup_"):
                        date_str = obj.object_name.split("_")[1]
                        obj_date = datetime.datetime.strptime(date_str, "%Y%m%d")
                        
                        if obj_date < cutoff_date:
                            client.remove_object(bucket, obj.object_name)
                            logger.info(f"Removed old backup: {obj.object_name}")
                except (ValueError, IndexError):
                    # Skip objects that don't match the expected format
                    pass
        
        return True
    except S3Error as e:
        logger.error(f"S3 upload failed: {e}")
        return False
    except Exception as e:
        logger.error(f"Upload failed: {e}")
        return False

def upload_via_scp(source_path: str, remote_host: str, remote_user: str, 
                  remote_path: str, ssh_key: Optional[str] = None) -> bool:
    """
    Upload backup using SCP.
    
    Args:
        source_path: Path to the backup file or directory
        remote_host: Remote host
        remote_user: Remote username
        remote_path: Remote path
        ssh_key: Path to SSH key file
    
    Returns:
        bool: True if successful, False otherwise
    """
    try:
        cmd = ["scp"]
        
        # Add SSH key if provided
        if ssh_key:
            cmd.extend(["-i", ssh_key])
        
        # Add recursive flag if source is a directory
        if os.path.isdir(source_path):
            cmd.append("-r")
        
        # Add source and destination
        cmd.append(source_path)
        cmd.append(f"{remote_user}@{remote_host}:{remote_path}")
        
        logger.info(f"Running SCP: {' '.join(cmd)}")
        result = subprocess.run(cmd, check=True, capture_output=True)
        logger.info(f"SCP completed successfully")
        return True
    except subprocess.CalledProcessError as e:
        logger.error(f"SCP failed: {e}")
        logger.error(f"stdout: {e.stdout.decode()}")
        logger.error(f"stderr: {e.stderr.decode()}")
        return False

def upload_via_sftp(source_path: str, remote_host: str, remote_user: str, 
                   remote_path: str, ssh_key: Optional[str] = None) -> bool:
    """
    Upload backup using SFTP.
    
    Args:
        source_path: Path to the backup file or directory
        remote_host: Remote host
        remote_user: Remote username
        remote_path: Remote path
        ssh_key: Path to SSH key file
    
    Returns:
        bool: True if successful, False otherwise
    """
    try:
        import paramiko
        
        # Create SSH client
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        
        # Connect to remote host
        connect_kwargs = {"username": remote_user, "hostname": remote_host}
        if ssh_key:
            connect_kwargs["key_filename"] = ssh_key
        
        client.connect(**connect_kwargs)
        
        # Create SFTP client
        sftp = client.open_sftp()
        
        # Upload file or directory
        if os.path.isdir(source_path):
            # Create remote directory if it doesn't exist
            try:
                sftp.mkdir(remote_path)
            except IOError:
                # Directory already exists
                pass
            
            # Upload each file in the directory
            for root, _, files in os.walk(source_path):
                for file in files:
                    local_path = os.path.join(root, file)
                    relative_path = os.path.relpath(local_path, source_path)
                    remote_file_path = os.path.join(remote_path, relative_path)
                    
                    # Create remote directory if it doesn't exist
                    remote_dir = os.path.dirname(remote_file_path)
                    try:
                        sftp.mkdir(remote_dir)
                    except IOError:
                        # Directory already exists
                        pass
                    
                    # Upload file
                    sftp.put(local_path, remote_file_path)
                    logger.info(f"Uploaded {local_path} to {remote_file_path}")
        else:
            # Upload single file
            remote_file_path = os.path.join(remote_path, os.path.basename(source_path))
            sftp.put(source_path, remote_file_path)
            logger.info(f"Uploaded {source_path} to {remote_file_path}")
        
        # Close connections
        sftp.close()
        client.close()
        
        return True
    except Exception as e:
        logger.error(f"SFTP upload failed: {e}")
        return False

def upload_via_rsync(source_path: str, remote_host: str, remote_user: str, 
                    remote_path: str, ssh_key: Optional[str] = None) -> bool:
    """
    Upload backup using rsync.
    
    Args:
        source_path: Path to the backup file or directory
        remote_host: Remote host
        remote_user: Remote username
        remote_path: Remote path
        ssh_key: Path to SSH key file
    
    Returns:
        bool: True if successful, False otherwise
    """
    try:
        cmd = ["rsync", "-avz"]
        
        # Add SSH key if provided
        if ssh_key:
            cmd.extend(["-e", f"ssh -i {ssh_key}"])
        
        # Add trailing slash to source directory to copy contents
        if os.path.isdir(source_path):
            source_path = os.path.join(source_path, "")
        
        # Add source and destination
        cmd.append(source_path)
        cmd.append(f"{remote_user}@{remote_host}:{remote_path}")
        
        logger.info(f"Running rsync: {' '.join(cmd)}")
        result = subprocess.run(cmd, check=True, capture_output=True)
        logger.info(f"rsync completed successfully")
        return True
    except subprocess.CalledProcessError as e:
        logger.error(f"rsync failed: {e}")
        logger.error(f"stdout: {e.stdout.decode()}")
        logger.error(f"stderr: {e.stderr.decode()}")
        return False

def upload_to_nfs(source_path: str, remote_path: str) -> bool:
    """
    Upload backup to NFS mount.
    
    Args:
        source_path: Path to the backup file or directory
        remote_path: Remote path (NFS mount point)
    
    Returns:
        bool: True if successful, False otherwise
    """
    try:
        # Create remote directory if it doesn't exist
        os.makedirs(remote_path, exist_ok=True)
        
        # Copy file or directory
        if os.path.isdir(source_path):
            # Get the name of the source directory
            source_name = os.path.basename(source_path)
            dest_path = os.path.join(remote_path, source_name)
            
            # Create destination directory
            os.makedirs(dest_path, exist_ok=True)
            
            # Copy each file
            for root, dirs, files in os.walk(source_path):
                # Create subdirectories in destination
                for dir_name in dirs:
                    src_dir = os.path.join(root, dir_name)
                    rel_path = os.path.relpath(src_dir, source_path)
                    dst_dir = os.path.join(dest_path, rel_path)
                    os.makedirs(dst_dir, exist_ok=True)
                
                # Copy files
                for file_name in files:
                    src_file = os.path.join(root, file_name)
                    rel_path = os.path.relpath(src_file, source_path)
                    dst_file = os.path.join(dest_path, rel_path)
                    shutil.copy2(src_file, dst_file)
                    logger.info(f"Copied {src_file} to {dst_file}")
        else:
            # Copy single file
            dest_file = os.path.join(remote_path, os.path.basename(source_path))
            shutil.copy2(source_path, dest_file)
            logger.info(f"Copied {source_path} to {dest_file}")
        
        return True
    except Exception as e:
        logger.error(f"NFS copy failed: {e}")
        return False

def upload_backup(source_path: str, args) -> bool:
    """
    Upload backup to remote storage.
    
    Args:
        source_path: Path to the backup file or directory
        args: Command line arguments
    
    Returns:
        bool: True if successful, False otherwise
    """
    if args.upload_method == "s3":
        if not args.remote_path:
            logger.error("Remote path (bucket) is required for S3 upload")
            return False
        return upload_to_s3(source_path, args.remote_path, args.retention_days)
    
    elif args.upload_method == "sftp":
        if not all([args.remote_host, args.remote_user, args.remote_path]):
            logger.error("Remote host, user, and path are required for SFTP upload")
            return False
        return upload_via_sftp(source_path, args.remote_host, args.remote_user, 
                              args.remote_path, args.remote_key)
    
    elif args.upload_method == "scp":
        if not all([args.remote_host, args.remote_user, args.remote_path]):
            logger.error("Remote host, user, and path are required for SCP upload")
            return False
        return upload_via_scp(source_path, args.remote_host, args.remote_user, 
                             args.remote_path, args.remote_key)
    
    elif args.upload_method == "rsync":
        if not all([args.remote_host, args.remote_user, args.remote_path]):
            logger.error("Remote host, user, and path are required for rsync upload")
            return False
        return upload_via_rsync(source_path, args.remote_host, args.remote_user, 
                               args.remote_path, args.remote_key)
    
    elif args.upload_method == "nfs":
        if not args.remote_path:
            logger.error("Remote path is required for NFS upload")
            return False
        return upload_to_nfs(source_path, args.remote_path)
    
    else:
        logger.error(f"Unsupported upload method: {args.upload_method}")
        return False

def main():
    """Main function to run the backup process."""
    args = parse_args()
    
    # Ensure backup directory exists
    backup_path = ensure_backup_dir(args.output_dir)
    
    # Perform backup
    if args.pg_dump:
        success = pg_dump_backup(backup_path, args.format)
    else:
        success = manual_backup(backup_path)
    
    if success:
        logger.info(f"Backup completed successfully: {backup_path}")
        # Create a symlink to the latest backup
        latest_link = os.path.join(args.output_dir, "latest")
        if os.path.exists(latest_link):
            os.unlink(latest_link)
        os.symlink(backup_path, latest_link)
        logger.info(f"Created symlink to latest backup: {latest_link}")
        
        # Upload backup if requested
        if args.upload:
            logger.info(f"Uploading backup to remote storage...")
            
            # Compress backup if requested
            if args.compress:
                upload_path = compress_backup(backup_path)
            else:
                upload_path = backup_path
            
            # Upload backup
            upload_success = upload_backup(upload_path, args)
            
            if upload_success:
                logger.info(f"Backup uploaded successfully")
            else:
                logger.error(f"Backup upload failed")
                sys.exit(1)
    else:
        logger.error("Backup failed")
        sys.exit(1)

if __name__ == "__main__":
    main() 