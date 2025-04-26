"""
End-to-end test for the full workflow of the application.
Makes real HTTP requests to test the complete flow from login to data processing.
"""
import json
import logging
import os
import tempfile
import time
import requests

from app.core.config import settings

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# API base URL - should be configurable for different environments
API_BASE_URL = "http://backend:8022"  # Default local development server

def get_auth_headers():
    """Get authentication headers by making a real login request."""
    login_data = {
        "username": settings.FIRST_SUPERUSER,
        "password": settings.FIRST_SUPERUSER_PASSWORD,
    }
    response = requests.post(
        f"{API_BASE_URL}{settings.API_V1_STR}/login/access-token",
        data=login_data
    )
    assert response.status_code == 200, f"Login failed: {response.text}"
    
    tokens = response.json()
    return {"Authorization": f"Bearer {tokens['access_token']}"}

def wait_for_datasource(
    auth_headers: dict[str, str],
    workspace_id: int,
    datasource_id: int,
    timeout: int = 30  # 30 seconds should be enough for test data
) -> bool:
    """Wait for datasource processing to complete."""
    end_time = time.time() + timeout
    
    while time.time() < end_time:
        response = requests.get(
            f"{API_BASE_URL}{settings.API_V1_STR}/workspaces/{workspace_id}/datasources/{datasource_id}",
            headers=auth_headers
        )
        
        if response.status_code == 200:
            datasource = response.json()
            status = datasource.get("status", "").lower()
            if status == "complete":
                logger.info(f"Datasource {datasource_id} processing completed")
                return True
            elif status == "failed":
                logger.error(f"Datasource {datasource_id} processing failed")
                return False
            logger.debug(f"Datasource {datasource_id} status: {status}")
        
        time.sleep(0.5)  # Check every 500ms
    
    logger.error(f"Datasource {datasource_id} processing timed out")
    return False

def wait_for_classification_job(
    auth_headers: dict[str, str],
    workspace_id: int,
    job_id: int,
    timeout: int = 30  # 30 seconds should be enough for test data
) -> bool:
    """Wait for classification job to complete."""
    end_time = time.time() + timeout
    
    while time.time() < end_time:
        response = requests.get(
            f"{API_BASE_URL}{settings.API_V1_STR}/workspaces/{workspace_id}/classification_jobs/{job_id}",
            headers=auth_headers
        )
        
        if response.status_code == 200:
            job = response.json()
            status = job.get("status", "").lower()
            if status == "completed":
                logger.info(f"Job {job_id} completed successfully")
                return True
            elif status in ["failed", "completed_with_errors"]:
                logger.error(f"Job {job_id} failed or completed with errors")
                return False
            logger.debug(f"Job {job_id} status: {status}")
        
        time.sleep(0.5)  # Check every 500ms
    
    logger.error(f"Classification job {job_id} timed out")
    return False

def run_workflow_test():
    """
    Test the complete workflow by making real HTTP requests:
    1. Create workspace
    2. Create datasource
    3. Create classification scheme
    4. Create and run classification job
    5. Create dataset
    6. Export dataset
    7. Import dataset to new workspace
    """
    try:
        # Get authentication token
        auth_headers = get_auth_headers()
        
        # === 1. Create Workspace ===
        workspace_name = f"Test Workflow Workspace {int(time.time())}"
        response = requests.post(
            f"{API_BASE_URL}{settings.API_V1_STR}/workspaces/",
            headers=auth_headers,
            json={
                "name": workspace_name,
                "description": "Workspace for full workflow test"
            }
        )
        assert response.status_code == 200, f"Failed to create workspace: {response.text}"
        workspace = response.json()
        workspace_id = workspace["id"]
        logger.info(f"Created workspace: {workspace_id}")
        
        # === 2. Create Datasource ===
        logger.info("Creating datasource...")
        response = requests.post(
            f"{API_BASE_URL}{settings.API_V1_STR}/workspaces/{workspace_id}/datasources/",
            headers=auth_headers,
            data={
                "name": "Test Text Datasource",
                "type": "text_block",
                "origin_details": json.dumps({
                    "text_content": "This is a test text about Berlin, Germany. Mentions Paris, France."
                })
            }
        )
        assert response.status_code == 201, f"Failed to create datasource: {response.text}"
        
        datasource = response.json()["data"][0]
        datasource_id = datasource["id"]
        logger.info(f"Created datasource: {datasource_id}")
        
        # Wait for processing
        success = wait_for_datasource(auth_headers, workspace_id, datasource_id)
        assert success, "Datasource processing failed"
        
        # === 3. Create Classification Scheme ===
        logger.info("Creating classification scheme...")
        response = requests.post(
            f"{API_BASE_URL}{settings.API_V1_STR}/workspaces/{workspace_id}/classification_schemes/",
            headers=auth_headers,
            json={
                "name": "Test Location Schema",
                "description": "Schema to extract locations",
                "model_instructions": "Extract cities and countries.",
                "fields": [
                    {"name": "cities", "description": "Cities mentioned", "type": "List[str]"},
                    {"name": "countries", "description": "Countries mentioned", "type": "List[str]"}
                ]
            }
        )
        assert response.status_code == 201, f"Failed to create scheme: {response.text}"
        
        scheme = response.json()
        scheme_id = scheme["id"]
        logger.info(f"Created scheme: {scheme_id}")
        
        # === 4. Create Classification Job ===
        logger.info("Creating classification job...")
        response = requests.post(
            f"{API_BASE_URL}{settings.API_V1_STR}/workspaces/{workspace_id}/classification_jobs/",
            headers=auth_headers,
            json={
                "name": "Test Classification Job",
                "description": "Job to classify test text",
                "configuration": {
                    "datasource_ids": [datasource_id],
                    "scheme_ids": [scheme_id]
                }
            }
        )
        assert response.status_code == 201, f"Failed to create job: {response.text}"
        
        job = response.json()
        job_id = job["id"]
        logger.info(f"Created job: {job_id}")
        
        # Wait for job completion
        success = wait_for_classification_job(auth_headers, workspace_id, job_id)
        assert success, "Classification job failed"
        
        # === 5. Create Dataset ===
        logger.info("Creating dataset...")
        response = requests.post(
            f"{API_BASE_URL}{settings.API_V1_STR}/workspaces/{workspace_id}/datasets/",
            headers=auth_headers,
            json={
                "name": "Test Dataset",
                "description": "Dataset from classified data",
                "datarecord_ids": [1],  # First record
                "source_job_ids": [job_id],
                "source_scheme_ids": [scheme_id]
            }
        )
        assert response.status_code == 201, f"Failed to create dataset: {response.text}"
        
        dataset = response.json()
        dataset_id = dataset["id"]
        logger.info(f"Created dataset: {dataset_id}")
        
        # === 6. Export Dataset ===
        logger.info("Exporting dataset...")
        response = requests.post(
            f"{API_BASE_URL}{settings.API_V1_STR}/workspaces/{workspace_id}/datasets/{dataset_id}/export",
            headers=auth_headers,
            params={"include_content": True, "include_results": True}
        )
        assert response.status_code == 200, f"Failed to export dataset: {response.text}"
        export_data = response.content
        
        # === 7. Import Dataset to New Workspace ===
        logger.info("Creating target workspace for import...")
        response = requests.post(
            f"{API_BASE_URL}{settings.API_V1_STR}/workspaces/",
            headers=auth_headers,
            json={
                "name": f"Import Test Workspace {int(time.time())}",
                "description": "Workspace for testing dataset import"
            }
        )
        assert response.status_code == 200, f"Failed to create import workspace: {response.text}"
        import_workspace_id = response.json()["id"]
        
        # Create temporary file for import
        with tempfile.NamedTemporaryFile(suffix='.json', delete=False) as temp_file:
            temp_file.write(export_data)
            temp_path = temp_file.name
        
        try:
            with open(temp_path, 'rb') as f:
                files = {'file': ('export.json', f, 'application/json')}
                response = requests.post(
                    f"{API_BASE_URL}{settings.API_V1_STR}/workspaces/{import_workspace_id}/datasets/import",
                    headers=auth_headers,
                    files=files
                )
            assert response.status_code == 200, f"Failed to import dataset: {response.text}"
            
            imported_dataset = response.json()
            logger.info(f"Successfully imported dataset: {imported_dataset['id']}")
            
        finally:
            if os.path.exists(temp_path):
                os.remove(temp_path)
        
        logger.info("Full workflow test completed successfully!")
        
    except Exception as e:
        logger.exception("Error during workflow test")
        raise

if __name__ == "__main__":
    run_workflow_test()