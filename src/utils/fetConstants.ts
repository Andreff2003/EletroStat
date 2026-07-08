/** Shared BioFET sweep constants. */
export const FET_TIME_DURATION_S = 60;
export const FET_TIME_DT_S = 0.5;
export const EXPECTED_FET_TIME_POINTS = Math.floor(FET_TIME_DURATION_S / FET_TIME_DT_S) + 1;

/** Gate voltage used for the simulated time-response (constant-bias readout). */
export const FET_TIME_VG_READ_V = 1.0;
