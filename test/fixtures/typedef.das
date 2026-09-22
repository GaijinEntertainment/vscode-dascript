// Single-line typedef
typedef MyInt = int
typedef MyString = string

// Multiline typedef with single type
typedef
    Coroutine = iterator<bool>

// Multiline typedef with multiple types
typedef
    Coroutine = iterator<bool>
    Coroutines = array<Coroutine>

// Multiline typedef with various types
typedef
    Handler = function<void>
    Handlers = array<Handler>
    HandlersTable = table<string; Handler>

// Multiline typedef with complex types
typedef
    GenFunc = generator<int>
    LambdaType = lambda<(x: int): int>
    TupleType = tuple<int; string; bool>

// Mixed whitespace
typedef
    Type1 = int
    Type2=string
    Type3   =   bool

// Lambda, block, and function signatures
typedef
    SimpleCallback = lambda<(x: int): void>
    BlockWithMultiParams = block<(name: string; age: int; active: bool): bool>
    FunctionWithReturn = function<(data: float; count: uint): string>
    LambdaNoParams = lambda<(): int>
    BlockVoidReturn = block<(id: int64): void>

// Distinct types
typedef distinct EntityId = int
typedef distinct Meters = float
typedef distinct FileHandle = void?
typedef private distinct Secret = int
typedef
    distinct PlayerId = int
    Score = float
