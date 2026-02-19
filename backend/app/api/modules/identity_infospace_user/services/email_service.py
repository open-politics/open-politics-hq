"""Email utilities for identity domain (templates, sending, content generation)."""

from dataclasses import dataclass
from pathlib import Path
from typing import Any
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.utils import formataddr

from jinja2 import Template

from app.core.config import settings


@dataclass
class EmailData:
    html_content: str
    subject: str


def render_email_template(*, template_name: str, context: dict[str, Any]) -> str:
    # app/email-templates/build/
    app_dir = Path(__file__).resolve().parents[4]  # services -> identity -> modules -> api -> app
    template_str = (app_dir / "email-templates" / "build" / template_name).read_text()
    html_content = Template(template_str).render(context)
    return html_content


def send_email(
    *,
    email_to: str,
    subject: str = "",
    html_content: str = "",
) -> None:
    assert settings.emails_enabled, "no provided configuration for email variables"

    print(f"📧 Sending email to {email_to}: {subject}")

    try:
        msg = MIMEMultipart('alternative')
        msg['Subject'] = subject
        msg['From'] = formataddr((settings.EMAILS_FROM_NAME, settings.EMAILS_FROM_EMAIL))
        msg['To'] = email_to

        html_part = MIMEText(html_content, 'html', 'utf-8')
        msg.attach(html_part)

        if settings.SMTP_SSL and settings.SMTP_PORT == 465:
            server = smtplib.SMTP_SSL(settings.SMTP_HOST, settings.SMTP_PORT)
        else:
            server = smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT)
            if settings.SMTP_TLS:
                server.starttls()

        try:
            if settings.SMTP_USER and settings.SMTP_PASSWORD:
                server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)

            server.send_message(msg)
            print(f"✅ Email sent successfully to {email_to}")

        finally:
            server.quit()

    except Exception as e:
        print(f"❌ Email send failed: {e}")
        raise


def generate_test_email(email_to: str) -> EmailData:
    project_name = settings.PROJECT_NAME
    subject = f"{project_name} - Test email"
    html_content = render_email_template(
        template_name="test_email.html",
        context={"project_name": settings.PROJECT_NAME, "email": email_to},
    )
    return EmailData(html_content=html_content, subject=subject)


def generate_reset_password_email(email_to: str, email: str, token: str) -> EmailData:
    project_name = settings.PROJECT_NAME
    subject = f"{project_name} - Password recovery for user {email}"
    link = f"{settings.server_host}/reset-password?token={token}"
    html_content = render_email_template(
        template_name="reset_password.html",
        context={
            "project_name": project_name,
            "username": email,
            "email": email_to,
            "valid_hours": settings.EMAIL_RESET_TOKEN_EXPIRE_HOURS,
            "link": link,
        },
    )
    return EmailData(html_content=html_content, subject=subject)


def generate_new_account_email(
    email_to: str, username: str, password: str
) -> EmailData:
    project_name = settings.PROJECT_NAME
    subject = f"{project_name} - New account for user {username}"
    html_content = render_email_template(
        template_name="new_account.html",
        context={
            "project_name": project_name,
            "username": username,
            "password": password,
            "email": email_to,
            "link": settings.server_host,
        },
    )
    return EmailData(html_content=html_content, subject=subject)


def generate_email_verification_email(email_to: str, username: str, token: str) -> EmailData:
    project_name = settings.PROJECT_NAME
    subject = f"{project_name} - Verify Your Email Address"
    verification_link = f"{settings.server_host}/accounts/verify-email?token={token}"
    html_content = render_email_template(
        template_name="email_verification.html",
        context={
            "project_name": project_name,
            "username": username,
            "email": email_to,
            "verification_link": verification_link,
            "valid_hours": 24,
        },
    )
    return EmailData(html_content=html_content, subject=subject)
