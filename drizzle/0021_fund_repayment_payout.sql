-- A full repayment of a fund (T-Invest BOND_REPAYMENT_FULL on a fund with blocked assets) pays money out
-- and leaves the units: a dividend, not a redemption (decision of 2026-10-17). The amount stays; the
-- quantity and price a redemption carried go. Positions are recalculated by the next sync or recalc.
UPDATE `operations`
SET `type` = 'dividend', `quantity` = '0', `price` = '0'
WHERE `type` = 'redemption'
  AND `origin` = 'tinvest'
  AND `instrument_id` IN (SELECT `id` FROM `instruments` WHERE `kind` = 'etf');
