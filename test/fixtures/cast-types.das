// Test fixture for cast and reinterpret type highlighting
// Types inside angle brackets should be highlighted as types

def test_reinterpret()
    var ptr = reinterpret<int?> somePointer
    var typed = reinterpret<TypeDecl?> typ.get_ptr()
    clear(unsafe(reinterpret<TypeDecl?> typ.get_ptr()).dim)

def test_cast()
    var x = cast<float> intValue
    var y = cast<CustomType> value

def test_upcast()
    var base = upcast<BaseClass> derived

// Reinterpret with built-in types
def test_builtin_reinterpret()
    var f = reinterpret<float> bits
    var i = reinterpret<int> floatBits
    var ptr = reinterpret<uint64> address

// Complex nested expressions with reinterpret
def complexExpression(typ : smart_ptr<TypeDecl>)
    clear(unsafe(reinterpret<TypeDecl?> typ.get_ptr()).dim)
    let result = reinterpret<SomeType?> getValue()

// Module-qualified types (namespace::Type)
// The module namespace should be highlighted as a type, not a variable
def test_module_qualified_types()
    var decl = reinterpret<ast::TypeDecl?> typ.get_ptr()
    var expr = cast<ast::Expression> value
    var node = upcast<math::Vector3> position

// Variable declarations with module-qualified types
def test_module_qualified_declarations()
    var td : ast::TypeDecl
    let expr : ast::Expression?
    var vec : math::Vector3 = getVector()

// smart_ptr with module-qualified types (template context)
def getCppType(typ : smart_ptr<ast::TypeDecl>&, var imports : table<string>&)
    pass

// Base types called as constructor casts should highlight as types
def test_constructor_casts()
    let u16 = uint16(0)
    let f = float(intValue)
    var v = float3(1.0, 2.0, 3.0)

// Module-qualified variable assignment: the member is a variable, not a type
def test_module_qualified_assignment(userName : string)
    user::userName = userName
    game::score += 1
    net::config.timeout = 5
    net::send_message(userName)

// range() is a builtin iterator function, not a constructor cast
def test_range_call()
    for i in range(10)
        pass
    var r : range
