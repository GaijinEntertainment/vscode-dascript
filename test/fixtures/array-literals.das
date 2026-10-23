// Test fixture: '[name' inside an expression is NOT a structure annotation

// Comprehension: '[for (...)' looked like an annotation call [for(...)];
// the ']' of STAT_SHORT[i] inside the string then closed the "annotation"
// and the string quotes flipped for the rest of the file
def bonus_text(it : Item) : string {
    let parts <- [for (i in range(STAT_COUNT)); "{STAT_SHORT[i]} {signed_text(it.bonus[i])}"; where it.bonus[i] != 0]
    return length(parts) > 0 ? join(parts, " ") : "no stat bonus"
}

// Array literals starting with a call or an identifier
def make_lists() {
    var refl <- [decode_reflection(vert_spv), decode_reflection(frag_spv)]
    var planes <- [r3 + r0, r3 - r0]
    let after_arrays = "still a string"
}

// Block annotation after '$' is still an annotation
def query_one(dt : float = 1.0f) {
    testProfile::queryEs() <| $ [es] (var pos : float3&) {
        pos += dt
    }
}

// Structure annotation with ']' inside a string argument
[some_annotation(name="x]")]
def annotated_after_string() {
    let s = "still a string"
}
