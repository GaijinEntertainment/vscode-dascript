// Test fixture for table type declarations
// Types inside table<> should be highlighted as types

struct Foo {
    toRespawn : table<NodeId, float>
}

// Simple table types
var simpleTable : table<int, string>
var playerScores : table<NodeId, int>
var entityHealth : table<NodeId, float>

// Variable names containing keywords should not highlight keywords within them
var modulesIncludes : table<string>
var classNames : array<string>
var functionPointers : table<string, function<():void>>

// Table with custom types
var customTable : table<EntityId, PlayerData>

// Table in function parameter
def processTable(var data : table<NodeId, float3>)
    return

// Array of tables
var arrayOfTables : array<table<NodeId, int>>

// Nested structures
var complex : table<NodeId, array<float>>

// Table with builtin types
var builtins : table<int64, double>
var mixed : table<uint, bool>

// Block comments inside generic arguments should stay comments
var nodeNetIds : table<uint64 /*NodeId*/; uint /*netId*/>
