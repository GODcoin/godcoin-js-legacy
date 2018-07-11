import { Asset } from './asset';

export namespace GODcoin {

  /*
  * Base fee multipliers
  */

  export const MIN_GOLD_FEE    = Asset.fromString('0.00000100 GOLD');
  export const MIN_SILVER_FEE  = Asset.fromString('0.00001000 SILVER');

  /*
  * Fee settings for individual addresses performing transactions
  */

  export const GOLD_FEE_MULT     = Asset.fromString('2.00000000 GOLD');
  export const SILVER_FEE_MULT   = Asset.fromString('2.00000000 SILVER');
  export const FEE_RESET_WINDOW  = 4;

  /*
  * Fee settings for the global network
  */

  export const NETWORK_FEE_GOLD_MULT   = Asset.fromString('1.00200000 GOLD');
  export const NETWORK_FEE_SILVER_MULT = Asset.fromString('1.00200000 SILVER');
  export const NETWORK_FEE_AVG_WINDOW  = 10;

  export const BOND_FEE = Asset.fromString('5.00000000 GOLD');

  /*
  * Miscellaneous constants
  */

  export const BLOCK_PROD_TIME = 3000;
  export const TX_EXPIRY_TIME = 60000;
}
