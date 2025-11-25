// Sample file for testing weAudit extension
// This file contains code that can be used to test findings, notes, and auditing features

export function vulnerableFunction(userInput: string): string {
    // Line 5-7: Potential SQL injection vulnerability
    const query = "SELECT * FROM users WHERE name = '" + userInput + "'";
    return query;
}

export function anotherFunction(): void {
    // Line 11-15: Some code to audit
    console.log("This is a test function");
    const x = 1;
    const y = 2;
    console.log(x + y);
}

export function thirdFunction(): number {
    // Line 19-25: More testable code
    let sum = 0;
    for (let i = 0; i < 10; i++) {
        sum += i;
    }
    return sum;
}

export function safeFunction(input: string): string {
    // Line 28-31: Safe implementation
    const sanitized = input.replace(/['"]/g, "");
    return sanitized;
}

// Line 34-40: Additional code for partial audit testing
export class TestClass {
    private value: number;

    constructor(value: number) {
        this.value = value;
    }

    getValue(): number {
        return this.value;
    }
}
