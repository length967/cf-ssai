-- Add tier column to channels table for authorization filtering
-- Tier values: 0x000 = no restrictions, 0x001-0xFFF = specific authorization tiers
-- SCTE-35 spec section 9.2

-- Add tier column (default 0 = no restrictions)
ALTER TABLE channels ADD COLUMN tier INTEGER DEFAULT 0;

-- Create index for tier filtering queries
CREATE INDEX IF NOT EXISTS idx_channels_tier ON channels(tier);

-- Add comment explaining tier values
-- Tier 0 (0x000): No restrictions - all ads allowed
-- Tier 1 (0x001): Basic tier - premium subscriber ads
-- Tier 2 (0x002): Premium tier - VIP ads only
-- Tier 3+ (0x003-0xFFF): Custom authorization tiers

