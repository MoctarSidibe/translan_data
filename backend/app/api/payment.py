"""
Simulated Payment API — Visa / Mastercard simulation.
No real payment processor. Validates card format, simulates processing delay,
records transaction, unlocks premium or grants marketplace knowledge access.

Card logic:
  Visa        starts with 4
  Mastercard  starts with 51-55 or 2221-2720
  Amex        starts with 34 or 37 (accepted but labeled 'Amex')
  Declined    card ending in 0000 → always declined (for testing)
"""
import asyncio
import re
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from app.database import get_db
from app.models.user import User
from app.models.knowledge import KnowledgeItem, MarketplacePurchase
from app.core.security import get_current_user

router = APIRouter(prefix="/api/payment", tags=["payment"])


class CardDetails(BaseModel):
    card_number: str       # 16 digits, spaces allowed
    card_holder: str
    expiry: str            # MM/YY
    cvv: str
    amount: float
    description: str = ""
    knowledge_id: int | None = None   # if buying marketplace item
    upgrade_premium: bool = False     # if buying premium subscription


class PaymentResult(BaseModel):
    success: bool
    transaction_id: str
    card_type: str
    last4: str
    amount: float
    message: str


def _detect_card_type(number: str) -> str:
    n = number.replace(" ", "").replace("-", "")
    if n.startswith("4"):
        return "Visa"
    if re.match(r"^5[1-5]", n) or re.match(r"^2(2[2-9][1-9]|[3-6]\d{2}|7[01]\d|720)", n):
        return "Mastercard"
    if re.match(r"^3[47]", n):
        return "Amex"
    return "Unknown"


def _validate_card(number: str, expiry: str, cvv: str) -> str | None:
    """Returns error message or None if valid."""
    n = number.replace(" ", "").replace("-", "")
    if not n.isdigit():
        return "Card number must contain only digits."
    if len(n) not in (15, 16):
        return "Card number must be 15 or 16 digits."

    # Luhn check
    total = 0
    for i, d in enumerate(reversed(n)):
        x = int(d)
        if i % 2 == 1:
            x *= 2
            if x > 9:
                x -= 9
        total += x
    if total % 10 != 0:
        return "Invalid card number."

    # Expiry
    m = re.match(r"^(\d{2})/(\d{2})$", expiry)
    if not m:
        return "Expiry must be MM/YY."
    month, year = int(m.group(1)), int(m.group(2)) + 2000
    now = datetime.now()
    if month < 1 or month > 12:
        return "Invalid expiry month."
    if year < now.year or (year == now.year and month < now.month):
        return "Card is expired."

    # CVV
    if not cvv.isdigit() or len(cvv) not in (3, 4):
        return "CVV must be 3 or 4 digits."

    return None


@router.post("/charge", response_model=PaymentResult)
async def charge(
    card: CardDetails,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    n = card.card_number.replace(" ", "").replace("-", "")
    last4 = n[-4:] if len(n) >= 4 else "0000"
    card_type = _detect_card_type(n)

    # 1. Simulate declined card BEFORE Luhn (last 4 = 0000 = test decline)
    if last4 == "0000":
        return PaymentResult(
            success=False,
            transaction_id="DECLINED",
            card_type=card_type,
            last4=last4,
            amount=card.amount,
            message="Card declined. Please use a different card.",
        )

    # 2. Validate card format (after decline check)
    err = _validate_card(card.card_number, card.expiry, card.cvv)
    if err:
        raise HTTPException(status_code=422, detail=err)

    if card_type == "Unknown":
        raise HTTPException(status_code=422, detail="Unsupported card type. Use Visa or Mastercard.")

    # 3. Simulate processing delay (realistic feel)
    await asyncio.sleep(1.5)

    # 4. Generate fake transaction ID
    import uuid
    txn_id = f"TXN-{uuid.uuid4().hex[:12].upper()}"

    # 5. Fulfill the purchase
    if card.upgrade_premium:
        user.is_premium = True
        db.add(user)

    if card.knowledge_id:
        result = await db.execute(
            select(KnowledgeItem).where(
                KnowledgeItem.id == card.knowledge_id,
                KnowledgeItem.is_public == True,
            )
        )
        item = result.scalar_one_or_none()
        if item:
            purchase = MarketplacePurchase(
                buyer_id=user.id,
                knowledge_id=card.knowledge_id,
                amount_paid=card.amount,
            )
            item.download_count += 1
            db.add(purchase)
            db.add(item)

    return PaymentResult(
        success=True,
        transaction_id=txn_id,
        card_type=card_type,
        last4=last4,
        amount=card.amount,
        message=f"Payment of ${card.amount:.2f} successful.",
    )


@router.get("/plans")
async def get_plans(user: User = Depends(get_current_user)):
    """Return available subscription plans."""
    return {
        "is_premium": user.is_premium,
        "plans": [
            {
                "id": "premium_monthly",
                "name": "Premium Monthly",
                "price": 9.99,
                "description": "Publish knowledge to the marketplace, access all public content.",
                "features": ["Publish knowledge", "Access marketplace", "Priority AI", "Unlimited storage"],
                "billing": "monthly",
            },
            {
                "id": "premium_yearly",
                "name": "Premium Yearly",
                "price": 79.99,
                "description": "Best value — 2 months free.",
                "features": ["Everything in Monthly", "2 months free", "Early access to new features"],
                "billing": "yearly",
            },
        ],
    }
