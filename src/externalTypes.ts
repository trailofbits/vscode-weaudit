/**
 * Response returned when copying code and permalink from a finding location.
 * Used by external consumers such as the Sarif Explorer integration.
 */
export interface FromLocationResponse {
    codeToCopy: string;
    permalink: string;
}
