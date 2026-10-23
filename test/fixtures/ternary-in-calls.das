// Test fixture: a ternary inside call arguments or brackets ends before
// the enclosing ')', ']', '}' or ','

// The ternary used to swallow the closing ')' and the call region
// stayed open for the rest of the file
def ternary_in_call(g : bool; b, c : int) {
    let t = pick(g ? b : c)
    let after_call = "still a string"
}

// Ternary in the first argument, followed by another argument
def ternary_then_argument(a : bool; b, c, d : int) {
    foo(a ? b : c, d)
    let after_args = 1
}

// Ternary inside an array literal and a block
def ternary_in_brackets(a : bool; b, c : int) {
    var items <- [a ? b : c, c]
    let after_array = 2
    invoke($() { return a ? b : c })
    let after_block = 3
}

// Brackets inside a branch do not end the ternary
def ternary_with_groups(delta, ang, PI, TWO_PI : float; arr : array<float>; i : int) {
    let r = delta > PI ? ang + (delta > 0.f ? 1.f : -1.f) * TWO_PI : arr[i]
    let after_groups = 4
}
