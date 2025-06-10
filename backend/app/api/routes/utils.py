from fastapi import APIRouter, Depends, UploadFile, File, HTTPException, status
from pydantic.networks import EmailStr
import fitz
from io import BytesIO
from typing import Dict, Any, Optional, List

from app.api.deps import get_current_active_superuser
from app.schemas import Message, ProviderInfo, ProviderModel, ProviderListResponse
from app.utils import generate_test_email, send_email
from app.core.opol_config import opol
from app.core.config import settings
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/utils", tags=["Utilities"])


@router.post(
    "/test-email/",
    dependencies=[Depends(get_current_active_superuser)],
    status_code=201,
)
def test_email(email_to: EmailStr) -> Message:
    """
    Test emails.
    """
    email_data = generate_test_email(email_to=email_to)
    send_email(
        email_to=email_to,
        subject=email_data.subject,
        html_content=email_data.html_content,
    )
    return Message(message="Test email sent")


@router.get('/healthz')
def healthz():
    return {"status": "ok"}, 200

@router.get('/healthz/readiness')
def readyz():
    return {"status": "ok"}, 200

@router.get('/healthz/liveness')
def liveness():
    return {"status": "ok"}, 200

@router.post("/extract-pdf-text")
async def extract_pdf_text(
    file: UploadFile = File(...),
):
    """Extract text from PDF without authentication"""
    if not file.filename.lower().endswith(".pdf"):
        return {"error": "Only PDF files are supported"}
    
    try:
        contents = await file.read()
        text = ""
        with fitz.open(stream=contents, filetype="pdf") as doc:
            for page in doc:
                text += page.get_text() + "\n"
        return {"text": text}
    except Exception as e:
        return {"error": f"PDF processing failed: {str(e)}"}

@router.post("/extract-pdf-metadata")
async def extract_pdf_metadata(
    file: UploadFile = File(...),
):
    """Extract metadata from PDF including title, author, etc."""
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")
    
    try:
        contents = await file.read()
        with fitz.open(stream=contents, filetype="pdf") as doc:
            # Extract metadata
            metadata = doc.metadata
            
            # Extract first page text for potential title extraction
            first_page_text = ""
            if doc.page_count > 0:
                first_page = doc[0]
                first_page_text = first_page.get_text()
            
            # Try to extract title from metadata or first page
            title = metadata.get("title", "")
            if not title and first_page_text:
                # If no title in metadata, try to extract from first page
                # Get first non-empty line that's not too long (likely a title)
                lines = [line.strip() for line in first_page_text.split('\n') if line.strip()]
                if lines and len(lines[0]) < 100:  # Assume title is not extremely long
                    title = lines[0]
            
            # Extract text content from all pages
            text_content = ""
            for page in doc:
                text_content += page.get_text() + "\n"
            
            # Create a summary from the first few paragraphs
            summary = ""
            paragraphs = [p for p in text_content.split('\n\n') if p.strip()]
            if paragraphs:
                # Use first paragraph or first 500 chars as summary
                summary = paragraphs[0][:500] + ("..." if len(paragraphs[0]) > 500 else "")
            
            return {
                "title": title or file.filename.replace(".pdf", ""),
                "author": metadata.get("author", ""),
                "subject": metadata.get("subject", ""),
                "keywords": metadata.get("keywords", ""),
                "creator": metadata.get("creator", ""),
                "producer": metadata.get("producer", ""),
                "text_content": text_content,
                "summary": summary,
                "page_count": doc.page_count
            }
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"PDF processing failed: {str(e)}")


@router.get("/scrape_article")
async def scrape_article(url: str):
    """
    Scrape article content from a URL using the centralized OPOL instance.
    
    Args:
        url: The URL of the article to scrape
        
    Returns:
        The scraped article content
    """
    if not opol:
        raise HTTPException(
            status_code=501, 
            detail="OPOL is not available. Make sure the package is installed and properly configured."
        )
    
    try:
        article_data = opol.scraping.url(url)

        print(article_data)
        
        return article_data

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to scrape article: {str(e)}"
        )

@router.get("/providers", response_model=ProviderListResponse, status_code=status.HTTP_200_OK)
async def get_providers() -> ProviderListResponse:
    """
    Returns a hardcoded list of available classification providers and their models.
    This is a temporary solution to bypass dynamic discovery issues.
    """
    logger.info("Route: Returning hardcoded classification providers.")
    
    hardcoded_providers: List[ProviderInfo] = [
        ProviderInfo(
            provider_name="gemini_native",
            models=[
                ProviderModel(name="gemini-2.5-flash", description="Google's most capable model."),
            ]
        ),
        ProviderInfo(
            provider_name="ollama",
            models=[
                ProviderModel(name="llama4.2", description="Meta's Llama 4.2 model."),
            ]
        )
    ]
    
    return ProviderListResponse(providers=hardcoded_providers)
    