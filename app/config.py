import os
from dotenv import load_dotenv


# In development, we can still load .env, but production relies on a Secrets Vault
if os.getenv("ENVIRONMENT", "development") == "development":
    load_dotenv()


class SecretsManager:
    """
    Enterprise Secrets Manager Interface.
    In a real production environment, this integrates with AWS Secrets Manager,
    HashiCorp Vault, or Azure Key Vault.
    """
    @staticmethod
    def get_secret(secret_name: str, default: str = "") -> str:
        # TODO: Implement production vault fetching here (e.g. boto3.client('secretsmanager'))
        # Fallback to os environment variables for development/container injection
        return os.getenv(secret_name, default)


class Config:
    """Enterprise configuration management"""
    OPENAI_API_KEY = SecretsManager.get_secret("OPENAI_API_KEY", "")
    OPENAI_MODEL = SecretsManager.get_secret("OPENAI_MODEL", "gpt-5-mini")
    OPENAI_TIMEOUT = int(SecretsManager.get_secret("OPENAI_TIMEOUT", "60"))
    AI_FAST_MODEL = SecretsManager.get_secret("AI_FAST_MODEL", "gpt-4o-mini")
    ANTHROPIC_API_KEY = SecretsManager.get_secret("ANTHROPIC_API_KEY", "")
    PORT = int(SecretsManager.get_secret("PORT", "8000"))
    ENVIRONMENT = SecretsManager.get_secret("ENVIRONMENT", "development")
