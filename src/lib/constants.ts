import { Asset } from './asset';

/*
 * Base fee multipliers
 */

export const GODCOIN_MIN_GOLD_FEE    = Asset.fromString('0.00001000 GOLD');
export const GODCOIN_MIN_SILVER_FEE  = Asset.fromString('0.00100000 SILVER');

/*
 * Fee settings for individual addresses performing transactions
 */

export const GODCOIN_GOLD_FEE_MULT     = 2;
export const GODCOIN_SILVER_FEE_MULT   = 2;
export const GODCOIN_FEE_RESET_WINDOW  = 4;

/*
 * Fee settings for the global network
 */

export const GODCOIN_NETWORK_FEE_MULT        = 1.008;
export const GODCOIN_NETWORK_FEE_AVG_WINDOW  = 10;
