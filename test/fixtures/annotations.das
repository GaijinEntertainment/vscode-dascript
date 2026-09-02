// Test fixture for annotations in daScript

// Structure annotations - appear before struct/class declarations
[match_copy]
struct CmdLocate : Cmd {
    override rtti = "CmdLocate"
    x : float
    y : float
    z : float
}

[match_as_is]
struct DataNode {
    value : int
    next : DataNode?
}

// Property/field annotations in classes
class AnnotationsComponent : Component {
    // Basic export annotations
    @export private export_me : int
    @serialize=false skip_me : int
    @no_export do_not_export_me : float

    // View and serialize name annotations with string values
    @view_name="Hello, world!"
    @serialize_name=hello_world // string without space do not require quotes
    bye_world : string

    // Hint annotation with quoted string
    @hint="This is a color field"
    @color
    color : float4

    // Collapse annotation
    @collapse
    nested_data : SomeStructure

    // Multiple annotations on single field
    @export
    @view_name="Position"
    @hint="Player position in 3D space"
    position : float3
}

// More field annotations examples
class AbstractGameClient : Component {
    hasLocalServer : bool
    currentScenarioRoundType : ScenarioRoundType
    @no_export localClientMessages : array<OnNetMessageCommand>

    @export
    @view_name="Player Name"
    playerName : string

    @serialize_name=hp
    @view_name="Health Points"
    health : int
}

// Function annotations
[deprecated]
def old_function() {
    pass
}

[cheat]
def foo() {
    pass
}

// Block annotations - appear after block declaration
def queryOne(dt:float=1.0f) {
    testProfile::queryEs() <| $ [es] (var pos:float3&;vel:float3 const) {
        pos += vel * dt
    }
}

// More structure annotations
[sealed]
class FinalClass {
    value : int
}

// Annotation with arguments in brackets
[some_annotation(arg1, arg2)]
struct AnnotatedStruct {
    field : float
}

// Multiple annotations on structure
[match_copy]
[serializable]
struct MultiAnnotated {
    data : int
}

// Call macro annotations - used for macro definitions
[call_macro(name="yield_from")]
class private YieldFrom : AstCallMacro
    def override visit(prog: ProgramPtr; mod: Module?)
        return true

// Another call macro annotation
[call_macro(name="co_continue")]
class private CoContinue : AstCallMacro
    def override visit(prog: ProgramPtr; mod: Module?)
        return false

// Function macro annotation
[function_macro]
class TestMacro
    def apply()
        return 1
// ============================================
// Function calls with named parameters
// NOT annotations - fn([arg1=val, arg2=val])
// ============================================

// Function call with named parameters - decl and modules are parameter names
def test_named_params(typ : TypeDecl?)
    describe([decl=typ, modules=false])

// More examples of function calls with named parameters
def test_more_named_params()
    configure([verbose=true, output="file.txt"])
    process([input=data, mode=1, validate=false])

// Mixed positional and named parameters
def test_mixed_params()
    someFunction(arg1, [named=value])
    callWithOptions(data, [format="json", pretty=true])

// Nested function calls with named parameters
def test_nested_named_params()
    outer([inner=nested([deep=value])])

// Named parameters with various value types
def test_named_param_values()
    func([intVal=42, floatVal=3.14, strVal="hello", boolVal=true])
    func([nullVal=null, negVal=-10])