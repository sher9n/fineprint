-- Remove the bet-logging feature (My bets page + admin "Win rate"/calibration), which was fed
-- entirely by user-logged bets. Nothing references "Bet", so dropping the table cascades its own
-- foreign keys ("Bet_userId_fkey", "Bet_marketId_fkey") and indexes.

-- DropTable
DROP TABLE "Bet";
