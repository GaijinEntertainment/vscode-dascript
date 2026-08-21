// Test fixture for lambda type declarations

// Lambda with void return type
var onSinglePlayer : lambda<void>
private onMultiPlayer : lambda<void>

// Lambda with int return type
var getScore : lambda<int>

// Lambda with float return type
var calculateDamage : lambda<float>

// Lambda with string return type
var getMessage : lambda<string>

// Lambda with custom type return type
var getNode : lambda<NodeId>

// Lambda with int2 vector type
var getPosition : lambda<int2>

// Lambda with float4 vector type
var getColor : lambda<float4>

// Lambda with bool return type
var isValid : lambda<bool>

// Lambda with uint64 return type
var getId : lambda<uint64>

// Lambda with double return type
var getPrecision : lambda<double>

// Lambda signature with var parameter modifier and nested generic type
var connected : lambda<(var urls : array<string>, userName : string) : void>
