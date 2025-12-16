"""
Flow Tasks
==========

Celery tasks for executing Flows.
"""

import logging
from celery import shared_task
from sqlmodel import Session

from app.core.db import engine
from app.api.services.flow_service import FlowService

logger = logging.getLogger(__name__)


@shared_task(bind=True, max_retries=3, default_retry_delay=60)
def execute_flow(self, execution_id: int):
    """
    Execute a FlowExecution.
    
    This task is queued when a Flow execution is triggered.
    It runs all steps in sequence.
    
    Args:
        execution_id: ID of the FlowExecution to run
    """
    logger.info(f"Starting FlowExecution {execution_id}")
    
    try:
        with Session(engine) as session:
            flow_service = FlowService(session)
            execution = flow_service.run_execution(execution_id)
            
            logger.info(
                f"FlowExecution {execution_id} completed with status: {execution.status}"
            )
            
            return {
                "execution_id": execution_id,
                "status": execution.status.value if execution.status else None,
                "input_count": len(execution.input_asset_ids),
                "output_count": len(execution.output_asset_ids),
            }
            
    except Exception as e:
        logger.error(f"FlowExecution {execution_id} failed: {e}", exc_info=True)
        
        # Update execution status on failure
        try:
            with Session(engine) as session:
                from app.models import FlowExecution, RunStatus
                from datetime import datetime, timezone
                
                execution = session.get(FlowExecution, execution_id)
                if execution:
                    execution.status = RunStatus.FAILED
                    execution.error_message = str(e)
                    execution.completed_at = datetime.now(timezone.utc)
                    session.add(execution)
                    session.commit()
        except Exception as update_error:
            logger.error(f"Failed to update execution status: {update_error}")
        
        # Retry if appropriate
        if self.request.retries < self.max_retries:
            raise self.retry(exc=e)
        
        raise


@shared_task
def trigger_flow_by_task(task_id: int):
    """
    Trigger a Flow execution from a scheduled Task.
    
    Called by Celery Beat when a Task with type='flow' is due.
    
    Args:
        task_id: ID of the Task that triggered this
    """
    logger.info(f"Task {task_id} triggering Flow execution")
    
    try:
        with Session(engine) as session:
            from app.models import Task, Flow
            
            task = session.get(Task, task_id)
            if not task:
                logger.error(f"Task {task_id} not found")
                return {"error": "Task not found"}
            
            flow_id = task.configuration.get("flow_id") or task.configuration.get("target_id")
            if not flow_id:
                logger.error(f"Task {task_id} has no flow_id in configuration")
                return {"error": "No flow_id configured"}
            
            flow = session.get(Flow, flow_id)
            if not flow:
                logger.error(f"Flow {flow_id} not found")
                return {"error": "Flow not found"}
            
            flow_service = FlowService(session)
            execution = flow_service.trigger_execution(
                flow_id=flow_id,
                user_id=flow.user_id,
                infospace_id=flow.infospace_id,
                triggered_by="task",
                triggered_by_task_id=task_id,
            )
            
            # Update task last run info
            from datetime import datetime, timezone
            task.last_run_at = datetime.now(timezone.utc)
            task.last_run_status = "triggered"
            session.add(task)
            session.commit()
            
            return {
                "task_id": task_id,
                "flow_id": flow_id,
                "execution_id": execution.id,
            }
            
    except Exception as e:
        logger.error(f"Failed to trigger Flow from Task {task_id}: {e}", exc_info=True)
        
        # Update task failure info
        try:
            with Session(engine) as session:
                from app.models import Task
                from datetime import datetime, timezone
                
                task = session.get(Task, task_id)
                if task:
                    task.last_run_at = datetime.now(timezone.utc)
                    task.last_run_status = "failed"
                    task.last_run_message = str(e)
                    task.consecutive_failure_count += 1
                    session.add(task)
                    session.commit()
        except Exception as update_error:
            logger.error(f"Failed to update task status: {update_error}")
        
        raise


@shared_task
def check_on_arrival_flows():
    """
    Periodic task to check for flows with on_arrival trigger mode.
    
    This should be scheduled to run frequently (e.g., every minute) via Celery Beat.
    It checks each active on_arrival flow for new assets and triggers execution if any.
    """
    logger.info("Checking on_arrival flows")
    
    triggered_count = 0
    
    try:
        with Session(engine) as session:
            from sqlmodel import select
            from app.models import Flow, FlowStatus, FlowTriggerMode
            
            # Get all active flows with on_arrival trigger
            flows = session.exec(
                select(Flow).where(
                    Flow.status == FlowStatus.ACTIVE,
                    Flow.trigger_mode == FlowTriggerMode.ON_ARRIVAL,
                )
            ).all()
            
            flow_service = FlowService(session)
            
            for flow in flows:
                # Check for delta assets
                delta_assets = flow_service._get_delta_assets(flow)
                
                if delta_assets:
                    logger.info(f"Flow {flow.id} has {len(delta_assets)} new assets, triggering")
                    
                    try:
                        flow_service.trigger_execution(
                            flow_id=flow.id,
                            user_id=flow.user_id,
                            infospace_id=flow.infospace_id,
                            triggered_by="on_arrival",
                        )
                        triggered_count += 1
                    except Exception as e:
                        logger.error(f"Failed to trigger Flow {flow.id}: {e}")
            
            return {
                "flows_checked": len(flows),
                "flows_triggered": triggered_count,
            }
            
    except Exception as e:
        logger.error(f"Error checking on_arrival flows: {e}", exc_info=True)
        raise
