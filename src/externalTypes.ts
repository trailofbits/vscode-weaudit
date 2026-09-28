/**
 * Response returned when resolving a finding location for external consumption,
 * containing the code snippet and its permalink.
 */
export interface FromLocationResponse {
    codeToCopy: string;
    permalink: string;
}
