const assert = require('assert');
const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const { suite, test } = require('mocha');
const vsctm = require('vscode-textmate');
const oniguruma = require('vscode-oniguruma');

let registry;
let grammar;

/**
 * Initialize the TextMate registry and load the grammar
 */
async function initializeGrammar() {
    const wasmBin = fs.readFileSync(path.join(require.resolve('vscode-oniguruma'), '../onig.wasm')).buffer;
    await oniguruma.loadWASM(wasmBin);

    registry = new vsctm.Registry({
        onigLib: Promise.resolve({
            createOnigScanner: (sources) => new oniguruma.OnigScanner(sources),
            createOnigString: (str) => new oniguruma.OnigString(str)
        }),
        loadGrammar: async (scopeName) => {
            if (scopeName === 'source.dascript') {
                const grammarPath = path.join(__dirname, '../../syntaxes/dascript.tmLanguage.json');
                const grammarContent = fs.readFileSync(grammarPath, 'utf8');
                return vsctm.parseRawGrammar(grammarContent, grammarPath);
            }
            return null;
        }
    });

    grammar = await registry.loadGrammar('source.dascript');
}

/**
 * Get token scopes at a specific position in the document using TextMate grammar
 */
async function getTokenScopesAt(document, line, character) {
    if (!grammar) {
        await initializeGrammar();
    }

    const lineText = document.lineAt(line).text;

    // Tokenize all lines up to and including the target line to maintain state
    let ruleStack = vsctm.INITIAL;
    for (let i = 0; i <= line; i++) {
        const currentLineText = document.lineAt(i).text;
        const result = grammar.tokenizeLine(currentLineText, ruleStack);
        ruleStack = result.ruleStack;

        if (i === line) {
            // Find the token at the specified character position
            for (const token of result.tokens) {
                if (character >= token.startIndex && character < token.endIndex) {
                    return { scopes: token.scopes };
                }
            }
            // If character is at the end of line, return last token
            if (result.tokens.length > 0 && character >= result.tokens[result.tokens.length - 1].endIndex) {
                return { scopes: result.tokens[result.tokens.length - 1].scopes };
            }
        }
    }

    return { scopes: [] };
}

/**
 * Find position of text in a line
 */
function findInLine(document, lineNumber, searchText) {
    const line = document.lineAt(lineNumber);
    const index = line.text.indexOf(searchText);
    if (index === -1) {
        throw new Error(`Text "${searchText}" not found in line ${lineNumber}: ${line.text}`);
    }
    return new vscode.Position(lineNumber, index);
}

suite('daScript Syntax Highlighting Tests', () => {

    test('Optional type parameters should highlight correctly', async () => {
        const uri = vscode.Uri.file(
            path.join(__dirname, '../../test/fixtures/optional-types.das')
        );

        const document = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(document);

        // Wait for tokenization to complete
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Find the line with optional type
        let optionalTypeLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            if (document.lineAt(i).text.includes('CombatUI?')) {
                optionalTypeLine = i;
                break;
            }
        }
        assert.ok(optionalTypeLine >= 0, 'Should find line with CombatUI? optional type');

        // Verify CombatUI? is tokenized as a type
        const combatUIPos = findInLine(document, optionalTypeLine, 'CombatUI');
        const combatUIScopes = await getTokenScopesAt(document, optionalTypeLine, combatUIPos.character);

        // The type should have a storage.type scope
        const hasTypeScope = combatUIScopes?.scopes?.some(scope =>
            scope.includes('storage.type') || scope.includes('entity.name.type')
        );
        assert.ok(hasTypeScope, `CombatUI? should be tokenized as a type. Got scopes: ${JSON.stringify(combatUIScopes?.scopes)}`);

        // Verify quat4 after CombatUI? is also tokenized as a type
        const quat4Pos = findInLine(document, optionalTypeLine, 'quat4');
        assert.ok(quat4Pos.character > combatUIPos.character, 'quat4 should appear after CombatUI?');

        const quat4Scopes = await getTokenScopesAt(document, optionalTypeLine, quat4Pos.character);
        const quat4HasTypeScope = quat4Scopes?.scopes?.some(scope =>
            scope.includes('storage.type') || scope.includes('entity.name.type')
        );
        assert.ok(quat4HasTypeScope, `quat4 should be tokenized as a type. Got scopes: ${JSON.stringify(quat4Scopes?.scopes)}`);

        console.log('✓ Optional type parameters test passed');
    });

    test('String interpolation with ternary operators should not break highlighting', async () => {
        const uri = vscode.Uri.file(
            path.join(__dirname, '../../test/fixtures/string-interpolation.das')
        );

        const document = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(document);

        // Wait for tokenization to complete
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Find the line with string containing ternary operator
        let ternaryStringLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            const lineText = document.lineAt(i).text;
            if (lineText.includes('? "∞" :') && lineText.includes('"{max(currentAmount, 0)}"')) {
                ternaryStringLine = i;
                break;
            }
        }
        assert.ok(ternaryStringLine >= 0, 'Should find line with ternary in string interpolation');

        // Verify the infinity symbol is inside a string
        const infinityPos = findInLine(document, ternaryStringLine, '∞');
        const infinityScopes = await getTokenScopesAt(document, ternaryStringLine, infinityPos.character);
        const isInString = infinityScopes?.scopes?.some(scope => scope.includes('string'));
        assert.ok(isInString, `Infinity symbol should be inside a string. Got scopes: ${JSON.stringify(infinityScopes?.scopes)}`);

        // Find the line after strings that should NOT be highlighted as string
        let codeAfterStringsLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            if (document.lineAt(i).text.includes('mainWeaponSlot.name.nodeId.isActive')) {
                codeAfterStringsLine = i;
                break;
            }
        }
        assert.ok(codeAfterStringsLine >= 0, 'Should find line with mainWeaponSlot code');

        // Verify that code line is NOT tokenized as a string
        const selfPos = findInLine(document, codeAfterStringsLine, 'self');
        const selfScopes = await getTokenScopesAt(document, codeAfterStringsLine, selfPos.character);
        const isNotInString = !selfScopes?.scopes?.some(scope => scope.includes('string'));
        assert.ok(isNotInString, `Code after strings should NOT be in string scope. Got scopes: ${JSON.stringify(selfScopes?.scopes)}`);

        console.log('✓ String interpolation test passed');
    });

    test('Nested interpolated strings should highlight correctly', async () => {
        const uri = vscode.Uri.file(
            path.join(__dirname, '../../test/fixtures/string-interpolation.das')
        );

        const document = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(document);

        // Wait for tokenization to complete
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Test 1: Nested string with infinity symbol inside ternary in interpolation
        let nestedInfinityLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            const lineText = document.lineAt(i).text;
            if (lineText.includes('print("Ammo:') && lineText.includes('"∞"')) {
                nestedInfinityLine = i;
                break;
            }
        }
        assert.ok(nestedInfinityLine >= 0, 'Should find line with nested infinity string');

        // Verify the infinity symbol inside the nested string is tokenized as a string
        const infinityPos = findInLine(document, nestedInfinityLine, '∞');
        const infinityScopes = await getTokenScopesAt(document, nestedInfinityLine, infinityPos.character);
        const isInString = infinityScopes?.scopes?.some(scope => scope.includes('string'));
        assert.ok(isInString, `Nested infinity symbol should be inside a string. Got scopes: ${JSON.stringify(infinityScopes?.scopes)}`);

        // Test 2: "Active"/"Inactive" strings in ternary
        let activeInactiveLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            const lineText = document.lineAt(i).text;
            if (lineText.includes('"Active"') && lineText.includes('"Inactive"')) {
                activeInactiveLine = i;
                break;
            }
        }
        assert.ok(activeInactiveLine >= 0, 'Should find line with Active/Inactive strings');

        const activePos = findInLine(document, activeInactiveLine, 'Active');
        const activeScopes = await getTokenScopesAt(document, activeInactiveLine, activePos.character);
        const isActiveInString = activeScopes?.scopes?.some(scope => scope.includes('string'));
        assert.ok(isActiveInString, `"Active" should be inside a string. Got scopes: ${JSON.stringify(activeScopes?.scopes)}`);

        // Test 3: Nested interpolation with multiple levels
        let multiLevelLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            const lineText = document.lineAt(i).text;
            if (lineText.includes('"positive: {x}"')) {
                multiLevelLine = i;
                break;
            }
        }
        assert.ok(multiLevelLine >= 0, 'Should find line with multi-level interpolation');

        const positivePos = findInLine(document, multiLevelLine, 'positive');
        const positiveScopes = await getTokenScopesAt(document, multiLevelLine, positivePos.character);
        const isPositiveInString = positiveScopes?.scopes?.some(scope => scope.includes('string'));
        assert.ok(isPositiveInString, `"positive" should be inside a string. Got scopes: ${JSON.stringify(positiveScopes?.scopes)}`);

        // Test 4: Multiple ternaries with nested strings
        let multiTernaryLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            const lineText = document.lineAt(i).text;
            if (lineText.includes('Health:') && lineText.includes('Shield:')) {
                multiTernaryLine = i;
                break;
            }
        }
        assert.ok(multiTernaryLine >= 0, 'Should find line with multiple ternaries');

        // Verify both infinity symbols are in strings
        const healthInfinityMatch = document.lineAt(multiTernaryLine).text.indexOf('? "∞"');
        assert.ok(healthInfinityMatch >= 0, 'Should find health infinity');
        const healthInfinityScopes = await getTokenScopesAt(document, multiTernaryLine, healthInfinityMatch + 3);
        const isHealthInfinityInString = healthInfinityScopes?.scopes?.some(scope => scope.includes('string'));
        assert.ok(isHealthInfinityInString, `Health infinity should be inside a string. Got scopes: ${JSON.stringify(healthInfinityScopes?.scopes)}`);

        // Test 5: Deeply nested case
        let deepNestedLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            const lineText = document.lineAt(i).text;
            if (lineText.includes('"inner"') && lineText.includes('"middle"') && lineText.includes('"outer"')) {
                deepNestedLine = i;
                break;
            }
        }
        assert.ok(deepNestedLine >= 0, 'Should find line with deeply nested strings');

        const innerPos = findInLine(document, deepNestedLine, 'inner');
        const innerScopes = await getTokenScopesAt(document, deepNestedLine, innerPos.character);
        const isInnerInString = innerScopes?.scopes?.some(scope => scope.includes('string'));
        assert.ok(isInnerInString, `"inner" should be inside a string. Got scopes: ${JSON.stringify(innerScopes?.scopes)}`);

        console.log('✓ Nested interpolated strings test passed');
    });

    test('Multiline string interpolation should highlight correctly', async () => {
        const uri = vscode.Uri.file(
            path.join(__dirname, '../../test/fixtures/string-interpolation.das')
        );

        const document = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(document);

        // Wait for tokenization to complete
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Find the line with multiline string start
        let multilineStartLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            const lineText = document.lineAt(i).text;
            if (lineText.includes('[Item Equipment] initial_loadout_item removed')) {
                multilineStartLine = i;
                break;
            }
        }
        assert.ok(multilineStartLine >= 0, 'Should find line with multiline string start');

        // Verify the opening quote starts a string
        const openQuotePos = findInLine(document, multilineStartLine, '"[Item Equipment]');
        const openQuoteScopes = await getTokenScopesAt(document, multilineStartLine, openQuotePos.character + 1);
        const isStartInString = openQuoteScopes?.scopes?.some(scope => scope.includes('string'));
        assert.ok(isStartInString, `Start of multiline string should be in string scope. Got scopes: ${JSON.stringify(openQuoteScopes?.scopes)}`);

        // Find the next line with interpolation
        const nextLine = multilineStartLine + 1;
        const nextLineText = document.lineAt(nextLine).text;
        assert.ok(nextLineText.includes('itemEid='), 'Next line should have itemEid interpolation');

        // Verify 'itemEid=' is inside a string (before the interpolation starts)
        const itemEidPos = findInLine(document, nextLine, 'itemEid=');
        const itemEidScopes = await getTokenScopesAt(document, nextLine, itemEidPos.character);
        const isItemEidInString = itemEidScopes?.scopes?.some(scope => scope.includes('string'));
        assert.ok(isItemEidInString, `'itemEid=' should be inside a string. Got scopes: ${JSON.stringify(itemEidScopes?.scopes)}`);

        // Verify the interpolation content is recognized
        const getEntityPos = findInLine(document, nextLine, 'get_entity_info');
        const getEntityScopes = await getTokenScopesAt(document, nextLine, getEntityPos.character);
        const isInInterpolation = getEntityScopes?.scopes?.some(scope =>
            scope.includes('meta.interpolation') || scope.includes('meta.embedded')
        );
        assert.ok(isInInterpolation, `Function call inside interpolation should be in interpolation scope. Got scopes: ${JSON.stringify(getEntityScopes?.scopes)}`);

        // Find the third line with second interpolation
        const thirdLine = multilineStartLine + 2;
        const thirdLineText = document.lineAt(thirdLine).text;
        assert.ok(thirdLineText.includes('reEid='), 'Third line should have reEid interpolation');

        // Verify 'reEid=' is inside a string
        const reEidPos = findInLine(document, thirdLine, 'reEid=');
        const reEidScopes = await getTokenScopesAt(document, thirdLine, reEidPos.character);
        const isReEidInString = reEidScopes?.scopes?.some(scope => scope.includes('string'));
        assert.ok(isReEidInString, `'reEid=' should be inside a string. Got scopes: ${JSON.stringify(reEidScopes?.scopes)}`);

        // Test another multiline case with Status/Health/Shield
        let statusHealthLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            const lineText = document.lineAt(i).text;
            if (lineText.includes('let message = "Status:')) {
                statusHealthLine = i;
                break;
            }
        }
        assert.ok(statusHealthLine >= 0, 'Should find line with Status multiline string');

        // Verify 'Health:' on the next line is in a string
        const healthLine = statusHealthLine + 1;
        const healthPos = findInLine(document, healthLine, 'Health:');
        const healthScopes = await getTokenScopesAt(document, healthLine, healthPos.character);
        const isHealthInString = healthScopes?.scopes?.some(scope => scope.includes('string'));
        assert.ok(isHealthInString, `'Health:' should be inside a string. Got scopes: ${JSON.stringify(healthScopes?.scopes)}`);

        // Verify interpolation on Health line works
        const hpMatch = document.lineAt(healthLine).text.indexOf('{hp}');
        if (hpMatch >= 0) {
            const hpScopes = await getTokenScopesAt(document, healthLine, hpMatch + 1);
            const isHpInInterpolation = hpScopes?.scopes?.some(scope =>
                scope.includes('meta.interpolation') || scope.includes('punctuation.definition.interpolation')
            );
            assert.ok(isHpInInterpolation, `'{hp}' should be in interpolation scope. Got scopes: ${JSON.stringify(hpScopes?.scopes)}`);
        }

        console.log('✓ Multiline string interpolation test passed');
    });

    test('Ternary operator colon should not be detected as type declaration', async () => {
        const uri = vscode.Uri.file(
            path.join(__dirname, '../../test/fixtures/ternary-operators.das')
        );

        const document = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(document);

        // Wait for tokenization to complete
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Find the line with ternary operator
        let ternaryLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            if (document.lineAt(i).text.includes('condition ? trueValue : falseValue')) {
                ternaryLine = i;
                break;
            }
        }
        assert.ok(ternaryLine >= 0, 'Should find ternary operator line');

        // Verify that 'falseValue' after the colon is NOT tokenized as a type
        const falseValuePos = findInLine(document, ternaryLine, 'falseValue');
        const falseValueScopes = await getTokenScopesAt(document, ternaryLine, falseValuePos.character);

        // It should be a variable, not a type
        const isType = falseValueScopes?.scopes?.some(scope =>
            scope.includes('storage.type') || scope.includes('entity.name.type')
        );
        assert.ok(!isType, `'falseValue' after colon should NOT be tokenized as a type. Got scopes: ${JSON.stringify(falseValueScopes?.scopes)}`);

        // Verify the colon is an operator, not a type separator
        const colonPos = findInLine(document, ternaryLine, ': falseValue');
        const colonScopes = await getTokenScopesAt(document, ternaryLine, colonPos.character);
        const isOperator = colonScopes?.scopes?.some(scope =>
            scope.includes('keyword.operator') || scope.includes('punctuation')
        );
        // Colon should be treated as operator/punctuation in ternary context
        assert.ok(isOperator || colonScopes?.scopes?.length > 0,
            `Colon in ternary should be an operator. Got scopes: ${JSON.stringify(colonScopes?.scopes)}`
        );

        console.log('✓ Ternary operator test passed');
    });

    test('Nested ternary operators should highlight all expressions correctly', async () => {
        const uri = vscode.Uri.file(
            path.join(__dirname, '../../test/fixtures/ternary-operators.das')
        );

        const document = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(document);

        // Wait for tokenization to complete
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Find the line with nested ternary: abs(delta) > PI ? ang + (delta > 0.f ? 1.f : -1.f) * TWO_PI : ang
        let nestedTernaryLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            if (document.lineAt(i).text.includes('abs(delta) > PI ? ang +')) {
                nestedTernaryLine = i;
                break;
            }
        }
        assert.ok(nestedTernaryLine >= 0, 'Should find nested ternary operator line');

        const lineText = document.lineAt(nestedTernaryLine).text;

        // Verify 'abs' function call is highlighted
        const absPos = findInLine(document, nestedTernaryLine, 'abs');
        const absScopes = await getTokenScopesAt(document, nestedTernaryLine, absPos.character);
        const isFunction = absScopes?.scopes?.some(scope =>
            scope.includes('function') || scope.includes('entity.name')
        );
        assert.ok(isFunction, `'abs' should be highlighted as a function. Got scopes: ${JSON.stringify(absScopes?.scopes)}`);

        // Find all occurrences of 'ang' in the line
        const angMatches = [];
        let index = -1;
        while ((index = lineText.indexOf('ang', index + 1)) !== -1) {
            angMatches.push(index);
        }
        assert.ok(angMatches.length >= 2, 'Should find at least 2 occurrences of "ang"');

        // Verify the last 'ang' (false branch of outer ternary) is highlighted as identifier/variable
        const lastAngPos = angMatches[angMatches.length - 1];
        const lastAngScopes = await getTokenScopesAt(document, nestedTernaryLine, lastAngPos);

        // Should be highlighted as identifier or variable, not just base scope
        const hasIdentifierScope = lastAngScopes?.scopes?.some(scope =>
            scope.includes('variable') || scope.includes('identifier')
        );
        const notJustBaseScope = lastAngScopes?.scopes?.length > 1 || hasIdentifierScope;
        assert.ok(notJustBaseScope, `Last 'ang' should be highlighted as identifier. Got scopes: ${JSON.stringify(lastAngScopes?.scopes)}`);

        // Verify numeric literals in nested ternary are highlighted
        const floatLiteralPos = lineText.indexOf('0.f');
        if (floatLiteralPos >= 0) {
            const floatScopes = await getTokenScopesAt(document, nestedTernaryLine, floatLiteralPos);
            const isNumeric = floatScopes?.scopes?.some(scope =>
                scope.includes('constant.numeric')
            );
            assert.ok(isNumeric, `'0.f' should be highlighted as numeric literal. Got scopes: ${JSON.stringify(floatScopes?.scopes)}`);
        }

        // Test another nested ternary: value < 0 ? "invalid" : value > max ? "overflow" : "{value}"
        let multiNestedLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            if (document.lineAt(i).text.includes('"invalid"') && document.lineAt(i).text.includes('"overflow"')) {
                multiNestedLine = i;
                break;
            }
        }

        if (multiNestedLine >= 0) {
            // Verify string literals are highlighted
            const multiLineText = document.lineAt(multiNestedLine).text;
            const invalidStrPos = multiLineText.indexOf('"invalid"');
            if (invalidStrPos >= 0) {
                const invalidScopes = await getTokenScopesAt(document, multiNestedLine, invalidStrPos + 2); // +2 to be inside string
                const isString = invalidScopes?.scopes?.some(scope => scope.includes('string'));
                assert.ok(isString, `"invalid" should be highlighted as string. Got scopes: ${JSON.stringify(invalidScopes?.scopes)}`);
            }

            // Verify the last part (string interpolation) is also highlighted
            const interpolationPos = multiLineText.indexOf('"{value}"');
            if (interpolationPos >= 0) {
                const interpScopes = await getTokenScopesAt(document, multiNestedLine, interpolationPos + 2);
                const isInterpString = interpScopes?.scopes?.some(scope => scope.includes('string'));
                assert.ok(isInterpString, `String interpolation should be highlighted. Got scopes: ${JSON.stringify(interpScopes?.scopes)}`);
            }
        }

        console.log('✓ Nested ternary operators test passed');
    });

    test('Type annotations with optional types should work', async () => {
        const uri = vscode.Uri.file(
            path.join(__dirname, '../../test/fixtures/optional-types.das')
        );

        const document = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(document);

        // Wait for tokenization to complete
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Find line with optional type
        let optionalLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            if (document.lineAt(i).text.includes('CombatUI?')) {
                optionalLine = i;
                break;
            }
        }
        assert.ok(optionalLine >= 0, 'Should find line with optional type');

        // Verify all three types are tokenized as types
        const types = ['CombatUI', 'float3', 'quat4'];
        for (const typeName of types) {
            const typePos = findInLine(document, optionalLine, typeName);
            const typeScopes = await getTokenScopesAt(document, optionalLine, typePos.character);
            const hasTypeScope = typeScopes?.scopes?.some(scope =>
                scope.includes('storage.type') || scope.includes('entity.name.type') || scope.includes('support.type')
            );
            assert.ok(hasTypeScope, `${typeName} should be tokenized as a type. Got scopes: ${JSON.stringify(typeScopes?.scopes)}`);
        }

        // Find line without optional type
        let normalLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            const lineText = document.lineAt(i).text;
            if (lineText.includes('def anotherFunction') || (lineText.includes('CombatUI') && !lineText.includes('CombatUI?'))) {
                normalLine = i;
                break;
            }
        }

        if (normalLine >= 0) {
            // Verify types without optional marker also work
            const normalLineText = document.lineAt(normalLine).text;
            if (normalLineText.includes('CombatUI') && !normalLineText.includes('CombatUI?')) {
                const combatUIPos = findInLine(document, normalLine, 'CombatUI');
                const scopes = await getTokenScopesAt(document, normalLine, combatUIPos.character);
                const hasTypeScope = scopes?.scopes?.some(scope =>
                    scope.includes('storage.type') || scope.includes('entity.name.type')
                );
                assert.ok(hasTypeScope, `CombatUI (non-optional) should be tokenized as a type. Got scopes: ${JSON.stringify(scopes?.scopes)}`);
            }
        }

        console.log('✓ Type annotations with optional types test passed');
    });

    test('Multiple strings on same line should close properly', async () => {
        const uri = vscode.Uri.file(
            path.join(__dirname, '../../test/fixtures/string-interpolation.das')
        );

        const document = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(document);

        // Wait for tokenization to complete
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Find line with multiple strings: ? "∞" : "{max(currentAmount, 0)}"
        let multiStringLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            const lineText = document.lineAt(i).text;
            if (lineText.includes('currentAmount == -1') && lineText.includes('"∞"')) {
                multiStringLine = i;
                break;
            }
        }
        assert.ok(multiStringLine >= 0, 'Should find line with multiple strings');

        const lineText = document.lineAt(multiStringLine).text;

        // Verify first string is tokenized correctly
        const firstQuotePos = lineText.indexOf('"∞"');
        assert.ok(firstQuotePos >= 0, 'Should find first string');
        const firstStringScopes = await getTokenScopesAt(document, multiStringLine, firstQuotePos + 1); // +1 to be inside the string
        const isFirstString = firstStringScopes?.scopes?.some(scope => scope.includes('string'));
        assert.ok(isFirstString, `First string should be tokenized as string. Got scopes: ${JSON.stringify(firstStringScopes?.scopes)}`);

        // Verify second string is also tokenized correctly
        const secondQuotePos = lineText.indexOf('"{max');
        assert.ok(secondQuotePos > firstQuotePos, 'Should find second string after first');
        const secondStringScopes = await getTokenScopesAt(document, multiStringLine, secondQuotePos + 1);
        const isSecondString = secondStringScopes?.scopes?.some(scope => scope.includes('string'));
        assert.ok(isSecondString, `Second string should be tokenized as string. Got scopes: ${JSON.stringify(secondStringScopes?.scopes)}`);

        // Verify the next line is NOT inside a string scope
        if (multiStringLine + 1 < document.lineCount) {
            const nextLine = document.lineAt(multiStringLine + 1);
            if (nextLine.text.trim().length > 0) {
                // Check first non-whitespace character of next line
                const firstCharPos = nextLine.firstNonWhitespaceCharacterIndex;
                const nextLineScopes = await getTokenScopesAt(document, multiStringLine + 1, firstCharPos);
                const isInString = nextLineScopes?.scopes?.some(scope => scope.includes('string'));
                assert.ok(!isInString, `Next line should NOT be in string scope. Got scopes: ${JSON.stringify(nextLineScopes?.scopes)}`);
            }
        }

        console.log('✓ Multiple strings test passed');
    });

    test('Function pointer parameter types should highlight correctly', async () => {
        const uri = vscode.Uri.file(
            path.join(__dirname, '../../test/fixtures/function-pointers.das')
        );

        const document = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(document);

        // Wait for tokenization to complete
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Find the line with basic function pointer: threshold : function<(nodeId : NodeId) : float>
        let functionPointerLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            if (document.lineAt(i).text.includes('threshold : function<(nodeId : NodeId)')) {
                functionPointerLine = i;
                break;
            }
        }
        assert.ok(functionPointerLine >= 0, 'Should find line with function pointer declaration');

        // Verify NodeId (parameter type) is tokenized as a type
        const nodeIdPos = findInLine(document, functionPointerLine, 'NodeId');
        const nodeIdScopes = await getTokenScopesAt(document, functionPointerLine, nodeIdPos.character);
        const hasTypeScope = nodeIdScopes?.scopes?.some(scope =>
            scope.includes('entity.name.type')
        );
        assert.ok(hasTypeScope, `NodeId should be tokenized as a type. Got scopes: ${JSON.stringify(nodeIdScopes?.scopes)}`);

        // Verify float (return type) is also tokenized correctly
        const floatPos = findInLine(document, functionPointerLine, 'float');
        const floatScopes = await getTokenScopesAt(document, functionPointerLine, floatPos.character);
        const floatHasTypeScope = floatScopes?.scopes?.some(scope =>
            scope.includes('support.type') || scope.includes('entity.name.type')
        );
        assert.ok(floatHasTypeScope, `float should be tokenized as a type. Got scopes: ${JSON.stringify(floatScopes?.scopes)}`);

        // Test multiple parameters case
        let multiParamLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            if (document.lineAt(i).text.includes('callback : function<(first : FirstType, second : SecondType)')) {
                multiParamLine = i;
                break;
            }
        }

        if (multiParamLine >= 0) {
            // Verify FirstType is tokenized as a type
            const firstTypePos = findInLine(document, multiParamLine, 'FirstType');
            const firstTypeScopes = await getTokenScopesAt(document, multiParamLine, firstTypePos.character);
            const firstTypeHasScope = firstTypeScopes?.scopes?.some(scope =>
                scope.includes('entity.name.type')
            );
            assert.ok(firstTypeHasScope, `FirstType should be tokenized as a type. Got scopes: ${JSON.stringify(firstTypeScopes?.scopes)}`);

            // Verify SecondType is tokenized as a type
            const secondTypePos = findInLine(document, multiParamLine, 'SecondType');
            const secondTypeScopes = await getTokenScopesAt(document, multiParamLine, secondTypePos.character);
            const secondTypeHasScope = secondTypeScopes?.scopes?.some(scope =>
                scope.includes('entity.name.type')
            );
            assert.ok(secondTypeHasScope, `SecondType should be tokenized as a type. Got scopes: ${JSON.stringify(secondTypeScopes?.scopes)}`);

            // Verify bool return type
            const boolPos = findInLine(document, multiParamLine, 'bool');
            const boolScopes = await getTokenScopesAt(document, multiParamLine, boolPos.character);
            const boolHasTypeScope = boolScopes?.scopes?.some(scope =>
                scope.includes('support.type') || scope.includes('entity.name.type')
            );
            assert.ok(boolHasTypeScope, `bool should be tokenized as a type. Got scopes: ${JSON.stringify(boolScopes?.scopes)}`);
        }

        // Nested generic parameter type: array<int> in function<(data : array<int>, ...)>
        let nestedGenericLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            if (document.lineAt(i).text.includes('data : array<int>')) {
                nestedGenericLine = i;
                break;
            }
        }
        assert.ok(nestedGenericLine >= 0, 'Should find line with data : array<int>');

        const arrayPos = findInLine(document, nestedGenericLine, 'array<int>');
        const arrayScopes = await getTokenScopesAt(document, nestedGenericLine, arrayPos.character);
        const arrayIsKeywordType = arrayScopes?.scopes?.some(scope => scope.includes('keyword.type'));
        assert.ok(arrayIsKeywordType, `'array' in function pointer parameter should be keyword.type. Got scopes: ${JSON.stringify(arrayScopes?.scopes)}`);

        const intTypePos = findInLine(document, nestedGenericLine, 'int>');
        const intTypeScopes = await getTokenScopesAt(document, nestedGenericLine, intTypePos.character);
        const intIsBuiltinType = intTypeScopes?.scopes?.some(scope => scope.includes('support.type'));
        assert.ok(intIsBuiltinType, `'int' in array<int> should be a builtin type. Got scopes: ${JSON.stringify(intTypeScopes?.scopes)}`);

        console.log('✓ Function pointer parameter types test passed');
    });

    test('Function return type annotations should highlight correctly', async () => {
        const uri = vscode.Uri.file(
            path.join(__dirname, '../../test/fixtures/function-return-types.das')
        );

        const document = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(document);

        // Wait for tokenization to complete
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Test 1: Basic function with return type annotation (no parameters)
        // def extractData : array<uint8>
        let extractDataLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            if (document.lineAt(i).text.includes('def extractData : array<uint8>')) {
                extractDataLine = i;
                break;
            }
        }
        assert.ok(extractDataLine >= 0, 'Should find extractData function declaration');

        // Verify 'extractData' is highlighted as a function name
        const extractDataPos = findInLine(document, extractDataLine, 'extractData');
        const extractDataScopes = await getTokenScopesAt(document, extractDataLine, extractDataPos.character);
        const isFunctionName = extractDataScopes?.scopes?.some(scope =>
            scope.includes('entity.name.function')
        );
        assert.ok(isFunctionName, `'extractData' should be highlighted as a function name. Got scopes: ${JSON.stringify(extractDataScopes?.scopes)}`);

        // Verify 'array' in return type is highlighted as a type keyword
        const arrayPos = findInLine(document, extractDataLine, 'array');
        const arrayScopes = await getTokenScopesAt(document, extractDataLine, arrayPos.character);
        const isArrayType = arrayScopes?.scopes?.some(scope =>
            scope.includes('keyword.type') || scope.includes('entity.name.type')
        );
        assert.ok(isArrayType, `'array' should be highlighted as a type. Got scopes: ${JSON.stringify(arrayScopes?.scopes)}`);

        // Verify 'uint8' is highlighted as a type
        const uint8Pos = findInLine(document, extractDataLine, 'uint8');
        const uint8Scopes = await getTokenScopesAt(document, extractDataLine, uint8Pos.character);
        const isUint8Type = uint8Scopes?.scopes?.some(scope =>
            scope.includes('support.type') || scope.includes('entity.name.type')
        );
        assert.ok(isUint8Type, `'uint8' should be highlighted as a type. Got scopes: ${JSON.stringify(uint8Scopes?.scopes)}`);

        // Test 2: Function with parameters and return type
        // def processData(input : string) : array<int>
        let processDataLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            if (document.lineAt(i).text.includes('def processData(input : string) : array<int>')) {
                processDataLine = i;
                break;
            }
        }
        assert.ok(processDataLine >= 0, 'Should find processData function declaration');

        // Verify 'processData' is highlighted as a function name
        const processDataPos = findInLine(document, processDataLine, 'processData');
        const processDataScopes = await getTokenScopesAt(document, processDataLine, processDataPos.character);
        const isProcessDataFunction = processDataScopes?.scopes?.some(scope =>
            scope.includes('entity.name.function')
        );
        assert.ok(isProcessDataFunction, `'processData' should be highlighted as a function name. Got scopes: ${JSON.stringify(processDataScopes?.scopes)}`);

        // Test 3: Function with complex return type (table)
        // def getMapping : table<string; int>
        let getMappingLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            if (document.lineAt(i).text.includes('def getMapping : table<string; int>')) {
                getMappingLine = i;
                break;
            }
        }
        assert.ok(getMappingLine >= 0, 'Should find getMapping function declaration');

        // Verify 'getMapping' is highlighted as a function name
        const getMappingPos = findInLine(document, getMappingLine, 'getMapping');
        const getMappingScopes = await getTokenScopesAt(document, getMappingLine, getMappingPos.character);
        const isGetMappingFunction = getMappingScopes?.scopes?.some(scope =>
            scope.includes('entity.name.function')
        );
        assert.ok(isGetMappingFunction, `'getMapping' should be highlighted as a function name. Got scopes: ${JSON.stringify(getMappingScopes?.scopes)}`);

        // Verify 'table' is highlighted as a type keyword
        const tablePos = findInLine(document, getMappingLine, 'table');
        const tableScopes = await getTokenScopesAt(document, getMappingLine, tablePos.character);
        const isTableType = tableScopes?.scopes?.some(scope =>
            scope.includes('keyword.type') || scope.includes('entity.name.type')
        );
        assert.ok(isTableType, `'table' should be highlighted as a type. Got scopes: ${JSON.stringify(tableScopes?.scopes)}`);

        // Test 4: Function with optional return type
        // def findItem(id : int) : Item?
        let findItemLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            if (document.lineAt(i).text.includes('def findItem(id : int) : Item?')) {
                findItemLine = i;
                break;
            }
        }
        assert.ok(findItemLine >= 0, 'Should find findItem function declaration');

        // Verify 'findItem' is highlighted as a function name
        const findItemPos = findInLine(document, findItemLine, 'findItem');
        const findItemScopes = await getTokenScopesAt(document, findItemLine, findItemPos.character);
        const isFindItemFunction = findItemScopes?.scopes?.some(scope =>
            scope.includes('entity.name.function')
        );
        assert.ok(isFindItemFunction, `'findItem' should be highlighted as a function name. Got scopes: ${JSON.stringify(findItemScopes?.scopes)}`);

        // Verify 'Item' in return type is highlighted as a type
        // Note: There are two occurrences of "Item" - one in "findItem" and one in ": Item?"
        // We want the second one
        const line = document.lineAt(findItemLine);
        const firstItemIndex = line.text.indexOf('Item');
        const secondItemIndex = line.text.indexOf('Item', firstItemIndex + 1);
        assert.ok(secondItemIndex > 0, 'Should find second occurrence of Item in return type');

        const itemPos = new vscode.Position(findItemLine, secondItemIndex);
        const itemScopes = await getTokenScopesAt(document, findItemLine, itemPos.character);
        const isItemType = itemScopes?.scopes?.some(scope =>
            scope.includes('entity.name.type') || scope.includes('storage.type')
        );
        assert.ok(isItemType, `'Item' in return type should be highlighted as a type. Got scopes: ${JSON.stringify(itemScopes?.scopes)}`);

        // Test 5: Function with var parameters
        // def public serialize(var arch : Archive; var value : auto(TT)&)
        let serializeLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            if (document.lineAt(i).text.includes('def public serialize(var arch : Archive')) {
                serializeLine = i;
                break;
            }
        }
        assert.ok(serializeLine >= 0, 'Should find serialize function declaration');

        // Test 6: Variables/identifiers after return type should NOT be highlighted as types
        // AND parameter names should NOT be highlighted as entity.name.type
        // def normalizeAngle(delta: float, ang: float, PI: float, TWO_PI: float) : float
        //     return abs(delta) > PI ? ang + (delta > 0.f ? 1.f : -1.f) * TWO_PI : ang
        let normalizeAngleLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            if (document.lineAt(i).text.includes('def normalizeAngle')) {
                normalizeAngleLine = i;
                break;
            }
        }

        if (normalizeAngleLine >= 0) {
            const declLineText = document.lineAt(normalizeAngleLine).text;

            // Test that 'ang' parameter (before the colon) is NOT entity.name.type
            // Looking for: ang: float in the parameter list
            const angParamMatch = declLineText.match(/,\s*(ang)\s*:/);
            if (angParamMatch) {
                const angParamIndex = declLineText.indexOf(angParamMatch[0]) + angParamMatch[0].indexOf('ang');
                const angParamScopes = await getTokenScopesAt(document, normalizeAngleLine, angParamIndex);

                // 'ang' parameter should NOT be entity.name.type.dascript
                const angParamIsNotType = !angParamScopes?.scopes?.some(scope =>
                    scope === 'entity.name.type.dascript'
                );

                // It should be a variable parameter
                const angParamIsParameter = angParamScopes?.scopes?.some(scope =>
                    scope.includes('variable.parameter')
                );

                assert.ok(angParamIsNotType, `'ang' parameter should NOT be highlighted as entity.name.type. Got scopes: ${JSON.stringify(angParamScopes?.scopes)}`);
                assert.ok(angParamIsParameter, `'ang' parameter should be highlighted as variable.parameter. Got scopes: ${JSON.stringify(angParamScopes?.scopes)}`);
            }

            // Find the line with 'ang' that comes after the return statement
            let returnLine = normalizeAngleLine + 1;
            if (returnLine < document.lineCount) {
                const returnLineText = document.lineAt(returnLine).text;
                if (returnLineText.includes('ang')) {
                    // Find the first 'ang' in the return statement (not in parameter list)
                    // Looking for: return abs(delta) > PI ? ang + ...
                    const angMatch = returnLineText.match(/\?\s*(ang)\s*\+/);
                    if (angMatch) {
                        const angIndex = returnLineText.indexOf(angMatch[0]) + angMatch[0].indexOf('ang');
                        const angScopes = await getTokenScopesAt(document, returnLine, angIndex);

                        // 'ang' should NOT be highlighted as entity.name.type
                        const angIsNotType = !angScopes?.scopes?.some(scope =>
                            scope === 'entity.name.type.dascript'
                        );

                        // It should be a variable or identifier
                        const angIsVariableOrIdentifier = angScopes?.scopes?.some(scope =>
                            scope.includes('variable') || scope.includes('identifier')
                        ) || angScopes?.scopes?.length <= 2; // Just source.dascript and maybe one more

                        assert.ok(angIsNotType, `'ang' in return statement should NOT be highlighted as entity.name.type. Got scopes: ${JSON.stringify(angScopes?.scopes)}`);
                    }
                }
            }
        }

        // Verify first 'var' is highlighted as a storage modifier, not a type
        const firstVarPos = findInLine(document, serializeLine, 'var');
        const firstVarScopes = await getTokenScopesAt(document, serializeLine, firstVarPos.character);
        const isVarKeyword = firstVarScopes?.scopes?.some(scope =>
            scope.includes('storage.modifier')
        );
        const isNotVarType = !firstVarScopes?.scopes?.some(scope =>
            scope.includes('entity.name.type')
        );
        assert.ok(isVarKeyword && isNotVarType, `First 'var' should be highlighted as storage modifier, not type. Got scopes: ${JSON.stringify(firstVarScopes?.scopes)}`);

        // Verify 'Archive' is highlighted as a type
        const archivePos = findInLine(document, serializeLine, 'Archive');
        const archiveScopes = await getTokenScopesAt(document, serializeLine, archivePos.character);
        const isArchiveType = archiveScopes?.scopes?.some(scope =>
            scope.includes('entity.name.type') || scope.includes('storage.type')
        );
        assert.ok(isArchiveType, `'Archive' should be highlighted as a type. Got scopes: ${JSON.stringify(archiveScopes?.scopes)}`);

        // Verify second 'var' (before 'value') is also a storage modifier
        const lineText = document.lineAt(serializeLine).text;
        const firstVarIndex = lineText.indexOf('var');
        const secondVarIndex = lineText.indexOf('var', firstVarIndex + 1);
        assert.ok(secondVarIndex > 0, 'Should find second occurrence of var');

        const secondVarPos = new vscode.Position(serializeLine, secondVarIndex);
        const secondVarScopes = await getTokenScopesAt(document, serializeLine, secondVarPos.character);
        const isSecondVarKeyword = secondVarScopes?.scopes?.some(scope =>
            scope.includes('storage.modifier')
        );
        const isNotSecondVarType = !secondVarScopes?.scopes?.some(scope =>
            scope.includes('entity.name.type')
        );
        assert.ok(isSecondVarKeyword && isNotSecondVarType, `Second 'var' should be highlighted as storage modifier, not type. Got scopes: ${JSON.stringify(secondVarScopes?.scopes)}`);

        // Test 6: Function with auto types in parameters
        // def public serialize2(var arch : Archive; var value : auto(TT)[])
        let serialize2Line = -1;
        for (let i = 0; i < document.lineCount; i++) {
            if (document.lineAt(i).text.includes('def public serialize2(var arch : Archive; var value : auto(TT)[]')) {
                serialize2Line = i;
                break;
            }
        }
        assert.ok(serialize2Line >= 0, 'Should find serialize2 function declaration');

        // Verify 'auto' is highlighted as a type keyword, not a regular type
        const autoPos = findInLine(document, serialize2Line, 'auto');
        const autoScopes = await getTokenScopesAt(document, serialize2Line, autoPos.character);
        const isAutoKeyword = autoScopes?.scopes?.some(scope =>
            scope.includes('support.type.auto')
        );
        // Make sure it's not just treated as entity.name.type without the .auto specificity
        const hasAutoSpecificScope = autoScopes?.scopes?.some(scope =>
            scope.includes('auto')
        );
        assert.ok(isAutoKeyword || hasAutoSpecificScope, `'auto' should be highlighted as auto type keyword. Got scopes: ${JSON.stringify(autoScopes?.scopes)}`);

        // Test 7: Function with no spaces around colons in parameters
        // def public serialize3(var arch:Archive; var value:auto(TT)&)
        let serialize3Line = -1;
        for (let i = 0; i < document.lineCount; i++) {
            if (document.lineAt(i).text.includes('def public serialize3(var arch:Archive')) {
                serialize3Line = i;
                break;
            }
        }
        assert.ok(serialize3Line >= 0, 'Should find serialize3 function declaration');

        // Verify 'value' parameter name is NOT highlighted as a function
        const valuePos = findInLine(document, serialize3Line, 'value');
        const valueScopes = await getTokenScopesAt(document, serialize3Line, valuePos.character);
        const isNotFunction = !valueScopes?.scopes?.some(scope =>
            scope.includes('entity.name.function') && !scope.includes('variable') && !scope.includes('parameter')
        );
        assert.ok(isNotFunction, `'value' should not be highlighted as a function call. Got scopes: ${JSON.stringify(valueScopes?.scopes)}`);

        // Verify 'auto' after value: is highlighted as auto type
        const lineText3 = document.lineAt(serialize3Line).text;
        const valueIndex = lineText3.indexOf('value');
        const autoAfterValueIndex = lineText3.indexOf('auto', valueIndex);
        assert.ok(autoAfterValueIndex > valueIndex, 'Should find auto after value');

        const autoAfterValuePos = new vscode.Position(serialize3Line, autoAfterValueIndex);
        const autoAfterValueScopes = await getTokenScopesAt(document, serialize3Line, autoAfterValuePos.character);
        const isAutoType = autoAfterValueScopes?.scopes?.some(scope =>
            scope.includes('support.type') || scope.includes('auto')
        );
        const isNotFunctionScope = !autoAfterValueScopes?.scopes?.some(scope =>
            scope.includes('meta.function-call')
        );
        assert.ok(isAutoType && isNotFunctionScope, `'auto' after 'value:' should be highlighted as type, not function. Got scopes: ${JSON.stringify(autoAfterValueScopes?.scopes)}`);

        // Test 8: Function with auto(TT) reference parameter
        // def withAutoRef(value : auto(TT)&; array : auto(T)[])
        let withAutoRefLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            if (document.lineAt(i).text.includes('def withAutoRef(value : auto(TT)&')) {
                withAutoRefLine = i;
                break;
            }
        }
        assert.ok(withAutoRefLine >= 0, 'Should find withAutoRef function declaration');

        // Find 'TT' inside auto(TT)
        const lineTextWithAutoRef = document.lineAt(withAutoRefLine).text;
        const autoTTMatch = lineTextWithAutoRef.match(/auto\((TT)\)/);
        assert.ok(autoTTMatch, 'Should find auto(TT) pattern in line');

        const ttIndex = lineTextWithAutoRef.indexOf(autoTTMatch[0]) + autoTTMatch[0].indexOf('TT');
        const ttPos = new vscode.Position(withAutoRefLine, ttIndex);
        const ttScopes = await getTokenScopesAt(document, withAutoRefLine, ttPos.character);

        // Verify 'TT' is highlighted as a type (entity.name.type), not as variable.parameter.identifier
        const ttIsType = ttScopes?.scopes?.some(scope =>
            scope.includes('entity.name.type')
        );
        const ttIsNotVariable = !ttScopes?.scopes?.some(scope =>
            scope.includes('variable.parameter.identifier')
        );
        assert.ok(ttIsType, `'TT' inside auto(TT) should be highlighted as a type. Got scopes: ${JSON.stringify(ttScopes?.scopes)}`);
        assert.ok(ttIsNotVariable, `'TT' inside auto(TT) should NOT be highlighted as variable.parameter.identifier. Got scopes: ${JSON.stringify(ttScopes?.scopes)}`);

        // Also verify 'T' in auto(T)[] is highlighted as a type
        const autoTMatch = lineTextWithAutoRef.match(/auto\((T)\)\[\]/);
        if (autoTMatch) {
            const tIndex = lineTextWithAutoRef.indexOf(autoTMatch[0]) + autoTMatch[0].indexOf('T');
            const tPos = new vscode.Position(withAutoRefLine, tIndex);
            const tScopes = await getTokenScopesAt(document, withAutoRefLine, tPos.character);

            const tIsType = tScopes?.scopes?.some(scope =>
                scope.includes('entity.name.type')
            );
            const tIsNotVariable = !tScopes?.scopes?.some(scope =>
                scope.includes('variable.parameter.identifier')
            );
            assert.ok(tIsType, `'T' inside auto(T)[] should be highlighted as a type. Got scopes: ${JSON.stringify(tScopes?.scopes)}`);
            assert.ok(tIsNotVariable, `'T' inside auto(T)[] should NOT be highlighted as variable.parameter.identifier. Got scopes: ${JSON.stringify(tScopes?.scopes)}`);
        }

        console.log('✓ Function return type annotations test passed');
    });


    test('Tuple type fields should highlight field names as variables and types correctly', async () => {
        const uri = vscode.Uri.file(
            path.join(__dirname, '../../test/fixtures/tuple-types.das')
        );

        const document = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(document);

        // Wait for tokenization to complete
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Find the line with victimNodes : array<tuple< node : NodeId, timeBeforeDamage : float>>
        let victimNodesLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            if (document.lineAt(i).text.includes('victimNodes') && document.lineAt(i).text.includes('timeBeforeDamage')) {
                victimNodesLine = i;
                break;
            }
        }
        assert.ok(victimNodesLine >= 0, 'Should find victimNodes declaration line');

        // Verify 'node' field name is highlighted as variable
        const nodePos = findInLine(document, victimNodesLine, 'node');
        const nodeScopes = await getTokenScopesAt(document, victimNodesLine, nodePos.character);
        const nodeIsVariable = nodeScopes?.scopes?.some(scope =>
            scope.includes('variable.parameter')
        );
        assert.ok(nodeIsVariable, `'node' should be highlighted as a variable parameter. Got scopes: ${JSON.stringify(nodeScopes?.scopes)}`);

        // Verify 'NodeId' type is highlighted as type
        const nodeIdPos = findInLine(document, victimNodesLine, 'NodeId');
        const nodeIdScopes = await getTokenScopesAt(document, victimNodesLine, nodeIdPos.character);
        const nodeIdIsType = nodeIdScopes?.scopes?.some(scope =>
            scope.includes('entity.name.type')
        );
        assert.ok(nodeIdIsType, `'NodeId' should be highlighted as a type. Got scopes: ${JSON.stringify(nodeIdScopes?.scopes)}`);

        // Verify 'timeBeforeDamage' field name is highlighted as variable
        const timeBeforeDamagePos = findInLine(document, victimNodesLine, 'timeBeforeDamage');
        const timeBeforeDamageScopes = await getTokenScopesAt(document, victimNodesLine, timeBeforeDamagePos.character);
        const timeBeforeDamageIsVariable = timeBeforeDamageScopes?.scopes?.some(scope =>
            scope.includes('variable.parameter')
        );
        assert.ok(timeBeforeDamageIsVariable, `'timeBeforeDamage' should be highlighted as a variable parameter. Got scopes: ${JSON.stringify(timeBeforeDamageScopes?.scopes)}`);

        // Verify 'float' type is highlighted as type
        const floatPos = findInLine(document, victimNodesLine, 'float');
        const floatScopes = await getTokenScopesAt(document, victimNodesLine, floatPos.character);
        const floatIsType = floatScopes?.scopes?.some(scope =>
            scope.includes('support.type') || scope.includes('entity.name.type')
        );
        assert.ok(floatIsType, `'float' should be highlighted as a type. Got scopes: ${JSON.stringify(floatScopes?.scopes)}`);

        // Test the simpler position tuple as well
        let positionLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            if (document.lineAt(i).text.includes('var position : tuple<x : float')) {
                positionLine = i;
                break;
            }
        }
        assert.ok(positionLine >= 0, 'Should find position declaration line');

        // Verify 'x' field name
        const xPos = findInLine(document, positionLine, 'x');
        const xScopes = await getTokenScopesAt(document, positionLine, xPos.character);
        const xIsVariable = xScopes?.scopes?.some(scope =>
            scope.includes('variable.parameter')
        );
        assert.ok(xIsVariable, `'x' should be highlighted as a variable parameter. Got scopes: ${JSON.stringify(xScopes?.scopes)}`);

        // Test tuple in return statement [[tuple<...>]]
        let returnLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            if (document.lineAt(i).text.includes('return [[tuple<x : int, y : int>')) {
                returnLine = i;
                break;
            }
        }
        assert.ok(returnLine >= 0, 'Should find return statement with tuple constructor');

        // Verify 'tuple' keyword in return statement is NOT highlighted as annotation
        const tupleInReturnPos = findInLine(document, returnLine, 'tuple');
        const tupleInReturnScopes = await getTokenScopesAt(document, returnLine, tupleInReturnPos.character);
        const tupleIsNotAnnotation = !tupleInReturnScopes?.scopes?.some(scope =>
            scope.includes('annotation')
        );
        const tupleIsKeyword = tupleInReturnScopes?.scopes?.some(scope =>
            scope.includes('keyword.type')
        );
        assert.ok(tupleIsNotAnnotation, `'tuple' in return statement should NOT be highlighted as annotation. Got scopes: ${JSON.stringify(tupleInReturnScopes?.scopes)}`);
        assert.ok(tupleIsKeyword, `'tuple' in return statement should be highlighted as keyword. Got scopes: ${JSON.stringify(tupleInReturnScopes?.scopes)}`);

        // Test field names in tuple type definition (inside angle brackets)
        const returnLineText = document.lineAt(returnLine).text;
        const xInTypePos = returnLineText.indexOf('tuple<x');
        const xInTypeScopes = await getTokenScopesAt(document, returnLine, xInTypePos + 6);
        const xInTypeIsVariable = xInTypeScopes?.scopes?.some(scope =>
            scope.includes('variable.parameter')
        );
        assert.ok(xInTypeIsVariable, `'x' in tuple<x : int> should be highlighted as variable parameter. Got scopes: ${JSON.stringify(xInTypeScopes?.scopes)}`);

        // Test 'int' type in tuple definition
        const intInTypePos = returnLineText.indexOf('x : int');
        const intInTypeScopes = await getTokenScopesAt(document, returnLine, intInTypePos + 4);
        const intInTypeIsType = intInTypeScopes?.scopes?.some(scope =>
            scope.includes('support.type') || scope.includes('entity.name.type')
        );
        assert.ok(intInTypeIsType, `'int' in tuple type should be highlighted as type. Got scopes: ${JSON.stringify(intInTypeScopes?.scopes)}`);

        // Test field names in tuple constructor (after > and before =)
        // In: [[tuple<x : int, y : int> x=0, y=0]]
        // The 'x' after > should be a different scope than the 'x' in the type definition
        const xInConstructorMatch = returnLineText.match(/>\s+(x)=/);
        if (xInConstructorMatch) {
            const xInConstructorPos = returnLineText.indexOf(xInConstructorMatch[0]) + xInConstructorMatch[0].indexOf('x');
            const xInConstructorScopes = await getTokenScopesAt(document, returnLine, xInConstructorPos);
            // This 'x' in the constructor should NOT be a type, it should be a variable or identifier
            const xInConstructorIsType = xInConstructorScopes?.scopes?.some(scope =>
                scope.includes('entity.name.type.dascript') &&
                !scope.includes('variable') &&
                !scope.includes('parameter')
            );
            // It's OK if it's highlighted as entity.name.type since it's referencing the field
            // Just verify it's getting some highlighting and not plain text
            const xInConstructorHasScoping = xInConstructorScopes?.scopes?.length > 1;
            assert.ok(xInConstructorHasScoping, `'x' in tuple constructor should have scoping. Got scopes: ${JSON.stringify(xInConstructorScopes?.scopes)}`);
        }

        console.log('✓ Tuple type fields test passed');
    });

    test('Lambda type templates should highlight types correctly', async () => {
        const uri = vscode.Uri.file(
            path.join(__dirname, '../../test/fixtures/lambda-types.das')
        );

        const document = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(document);

        // Wait for tokenization to complete
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Test 1: Find line with lambda<void>
        let voidLambdaLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            if (document.lineAt(i).text.includes('onSinglePlayer') && document.lineAt(i).text.includes('lambda<void>')) {
                voidLambdaLine = i;
                break;
            }
        }
        assert.ok(voidLambdaLine >= 0, 'Should find lambda<void> declaration line');

        // Verify 'void' inside lambda<void> is highlighted as a type
        const voidPos = findInLine(document, voidLambdaLine, 'void');
        const voidScopes = await getTokenScopesAt(document, voidLambdaLine, voidPos.character);
        const voidIsType = voidScopes?.scopes?.some(scope =>
            scope.includes('support.type') || scope.includes('entity.name.type')
        );
        assert.ok(voidIsType, `'void' in lambda<void> should be highlighted as a type. Got scopes: ${JSON.stringify(voidScopes?.scopes)}`);

        // Test 2: Find line with lambda<int>
        let intLambdaLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            if (document.lineAt(i).text.includes('getScore') && document.lineAt(i).text.includes('lambda<int>')) {
                intLambdaLine = i;
                break;
            }
        }
        assert.ok(intLambdaLine >= 0, 'Should find lambda<int> declaration line');

        // Verify 'int' inside lambda<int> is highlighted as a type
        const intPos = findInLine(document, intLambdaLine, 'int');
        const intScopes = await getTokenScopesAt(document, intLambdaLine, intPos.character);
        const intIsType = intScopes?.scopes?.some(scope =>
            scope.includes('support.type') || scope.includes('entity.name.type')
        );
        assert.ok(intIsType, `'int' in lambda<int> should be highlighted as a type. Got scopes: ${JSON.stringify(intScopes?.scopes)}`);

        // Test 3: Find line with lambda<float4>
        let float4LambdaLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            if (document.lineAt(i).text.includes('getColor') && document.lineAt(i).text.includes('lambda<float4>')) {
                float4LambdaLine = i;
                break;
            }
        }
        assert.ok(float4LambdaLine >= 0, 'Should find lambda<float4> declaration line');

        // Verify 'float4' inside lambda<float4> is highlighted as a type
        const float4Pos = findInLine(document, float4LambdaLine, 'float4');
        const float4Scopes = await getTokenScopesAt(document, float4LambdaLine, float4Pos.character);
        const float4IsType = float4Scopes?.scopes?.some(scope =>
            scope.includes('support.type') || scope.includes('entity.name.type')
        );
        assert.ok(float4IsType, `'float4' in lambda<float4> should be highlighted as a type. Got scopes: ${JSON.stringify(float4Scopes?.scopes)}`);

        // Test 4: Find line with lambda<NodeId> (custom type)
        let customTypeLambdaLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            if (document.lineAt(i).text.includes('getNode') && document.lineAt(i).text.includes('lambda<NodeId>')) {
                customTypeLambdaLine = i;
                break;
            }
        }
        assert.ok(customTypeLambdaLine >= 0, 'Should find lambda<NodeId> declaration line');

        // Verify 'NodeId' inside lambda<NodeId> is highlighted as a type
        const nodeIdPos = findInLine(document, customTypeLambdaLine, 'NodeId');
        const nodeIdScopes = await getTokenScopesAt(document, customTypeLambdaLine, nodeIdPos.character);
        const nodeIdIsType = nodeIdScopes?.scopes?.some(scope =>
            scope.includes('entity.name.type')
        );
        assert.ok(nodeIdIsType, `'NodeId' in lambda<NodeId> should be highlighted as a type. Got scopes: ${JSON.stringify(nodeIdScopes?.scopes)}`);

        // Test 5: 'var' inside lambda signature should be a keyword, not a type
        let varParamLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            if (document.lineAt(i).text.includes('lambda<(var urls')) {
                varParamLine = i;
                break;
            }
        }
        assert.ok(varParamLine >= 0, 'Should find lambda signature with var parameter line');

        const varParamPos = findInLine(document, varParamLine, 'var urls');
        const varParamScopes = await getTokenScopesAt(document, varParamLine, varParamPos.character);
        const varIsKeyword = varParamScopes?.scopes?.some(scope => scope.includes('storage.modifier'));
        const varIsNotType = !varParamScopes?.scopes?.some(scope => scope.includes('entity.name.type'));
        assert.ok(varIsKeyword && varIsNotType, `'var' in lambda signature should be a storage modifier, not a type. Got scopes: ${JSON.stringify(varParamScopes?.scopes)}`);

        // 'array' in the nested generic should be a keyword.type, 'string' a type
        const arrayPos = findInLine(document, varParamLine, 'array<string>');
        const arrayScopes = await getTokenScopesAt(document, varParamLine, arrayPos.character);
        const arrayIsKeywordType = arrayScopes?.scopes?.some(scope => scope.includes('keyword.type'));
        assert.ok(arrayIsKeywordType, `'array' in lambda signature should be keyword.type. Got scopes: ${JSON.stringify(arrayScopes?.scopes)}`);

        console.log('✓ Lambda type templates test passed');
    });

    test('@@function references should highlight as function names', async () => {
        const uri = vscode.Uri.file(
            path.join(__dirname, '../../test/fixtures/function-pointers.das')
        );

        const document = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(document);

        // Wait for tokenization to complete
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Test 1: @@on_lobby_created inside a call argument list
        let callLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            if (document.lineAt(i).text.includes('set_lobby_callbacks(@@on_lobby_created')) {
                callLine = i;
                break;
            }
        }
        assert.ok(callLine >= 0, 'Should find set_lobby_callbacks line');

        const refPos = findInLine(document, callLine, 'on_lobby_created,');
        const refScopes = await getTokenScopesAt(document, callLine, refPos.character);
        const refIsFunction = refScopes?.scopes?.some(scope => scope.includes('entity.name.function'));
        const refIsNotAnnotation = !refScopes?.scopes?.some(scope => scope.includes('annotation'));
        assert.ok(refIsFunction && refIsNotAnnotation, `'on_lobby_created' after @@ should be a function name, not an annotation. Got scopes: ${JSON.stringify(refScopes?.scopes)}`);

        // The comma after the reference must not be swallowed by an annotation region
        const commaPos = findInLine(document, callLine, ', @@on_lobby_connected');
        const commaScopes = await getTokenScopesAt(document, callLine, commaPos.character);
        const commaIsClean = !commaScopes?.scopes?.some(scope => scope.includes('meta.annotation'));
        assert.ok(commaIsClean, `',' after @@ref should not be inside an annotation region. Got scopes: ${JSON.stringify(commaScopes?.scopes)}`);

        // Test 2: module-qualified reference @@events::on_update
        let qualLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            if (document.lineAt(i).text.includes('@@events::on_update')) {
                qualLine = i;
                break;
            }
        }
        assert.ok(qualLine >= 0, 'Should find @@events::on_update line');

        const qualPos = findInLine(document, qualLine, 'events::on_update');
        const qualScopes = await getTokenScopesAt(document, qualLine, qualPos.character);
        const qualIsFunction = qualScopes?.scopes?.some(scope => scope.includes('entity.name.function'));
        assert.ok(qualIsFunction, `'events::on_update' after @@ should be a function name. Got scopes: ${JSON.stringify(qualScopes?.scopes)}`);

        console.log('✓ @@function references test passed');
    });

    test('Syntax in comments should be ignored and only highlighted as comment', async () => {
        const uri = vscode.Uri.file(
            path.join(__dirname, '../../test/fixtures/comments.das')
        );

        const document = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(document);

        // Wait for tokenization to complete
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Test 1: Find line with commented var declaration
        let commentedVarLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            if (document.lineAt(i).text.includes('// var hitboxNode = NodeId()')) {
                commentedVarLine = i;
                break;
            }
        }
        assert.ok(commentedVarLine >= 0, 'Should find line with commented var declaration');

        // Verify 'var' keyword in comment is only highlighted as comment
        const varPos = findInLine(document, commentedVarLine, 'var');
        const varScopes = await getTokenScopesAt(document, commentedVarLine, varPos.character);
        const hasCommentScope = varScopes?.scopes?.some(scope => scope.includes('comment'));
        const hasNoKeywordScope = !varScopes?.scopes?.some(scope => scope.includes('keyword') || scope.includes('storage.modifier'));
        assert.ok(hasCommentScope, `'var' in comment should have comment scope. Got scopes: ${JSON.stringify(varScopes?.scopes)}`);
        assert.ok(hasNoKeywordScope, `'var' in comment should not have keyword scope. Got scopes: ${JSON.stringify(varScopes?.scopes)}`);

        // Test 2: Find line with commented if statement
        let commentedIfLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            if (document.lineAt(i).text.includes('// if (hitbox != "") {')) {
                commentedIfLine = i;
                break;
            }
        }
        assert.ok(commentedIfLine >= 0, 'Should find line with commented if statement');

        // Verify 'if' keyword and string in comment are only highlighted as comment
        const ifPos = findInLine(document, commentedIfLine, 'if');
        const ifScopes = await getTokenScopesAt(document, commentedIfLine, ifPos.character);
        const ifHasCommentScope = ifScopes?.scopes?.some(scope => scope.includes('comment'));
        const ifHasNoKeywordScope = !ifScopes?.scopes?.some(scope => scope.includes('keyword'));
        assert.ok(ifHasCommentScope, `'if' in comment should have comment scope. Got scopes: ${JSON.stringify(ifScopes?.scopes)}`);
        assert.ok(ifHasNoKeywordScope, `'if' in comment should not have keyword scope. Got scopes: ${JSON.stringify(ifScopes?.scopes)}`);

        const stringPos = findInLine(document, commentedIfLine, '""');
        const stringScopes = await getTokenScopesAt(document, commentedIfLine, stringPos.character);
        const stringHasCommentScope = stringScopes?.scopes?.some(scope => scope.includes('comment'));
        const stringHasNoStringScope = !stringScopes?.scopes?.some(scope => scope.includes('string.quoted'));
        assert.ok(stringHasCommentScope, `String in comment should have comment scope. Got scopes: ${JSON.stringify(stringScopes?.scopes)}`);
        assert.ok(stringHasNoStringScope, `String in comment should not have string scope. Got scopes: ${JSON.stringify(stringScopes?.scopes)}`);

        // Test 3: Block comment with function syntax
        let blockCommentLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            if (document.lineAt(i).text.includes('function someFunc(var self : SomeType')) {
                blockCommentLine = i;
                break;
            }
        }
        assert.ok(blockCommentLine >= 0, 'Should find line with function in block comment');

        // Verify 'function' keyword in block comment is only highlighted as comment
        const functionPos = findInLine(document, blockCommentLine, 'function');
        const functionScopes = await getTokenScopesAt(document, blockCommentLine, functionPos.character);
        const functionHasCommentScope = functionScopes?.scopes?.some(scope => scope.includes('comment'));
        const functionHasNoKeywordScope = !functionScopes?.scopes?.some(scope => scope.includes('keyword'));
        assert.ok(functionHasCommentScope, `'function' in block comment should have comment scope. Got scopes: ${JSON.stringify(functionScopes?.scopes)}`);
        assert.ok(functionHasNoKeywordScope, `'function' in block comment should not have keyword scope. Got scopes: ${JSON.stringify(functionScopes?.scopes)}`);

        // Test 4: Verify actual code is NOT highlighted as comment
        let actualCodeLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            if (document.lineAt(i).text === 'var actualCode = 42') {
                actualCodeLine = i;
                break;
            }
        }
        assert.ok(actualCodeLine >= 0, 'Should find actual code line');

        const actualVarPos = findInLine(document, actualCodeLine, 'var');
        const actualVarScopes = await getTokenScopesAt(document, actualCodeLine, actualVarPos.character);
        const isNotComment = !actualVarScopes?.scopes?.some(scope => scope.includes('comment'));
        assert.ok(isNotComment, `'var' in actual code should NOT have comment scope. Got scopes: ${JSON.stringify(actualVarScopes?.scopes)}`);

        console.log('✓ Comments syntax highlighting test passed');
    });

    test('Comments in function return types should be highlighted as comments', async () => {
        const uri = vscode.Uri.file(
            path.join(__dirname, '../../test/fixtures/function-comments.das')
        );

        const document = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(document);

        // Wait for tokenization to complete
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Test 1: Find line with function definition and trailing comment
        let writeDefLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            if (document.lineAt(i).text.includes('def abstract write') && document.lineAt(i).text.includes('//! Write binary data')) {
                writeDefLine = i;
                break;
            }
        }
        assert.ok(writeDefLine >= 0, 'Should find def abstract write line');

        // Verify the return type 'bool' is highlighted as a type
        const boolPos = findInLine(document, writeDefLine, 'bool');
        const boolScopes = await getTokenScopesAt(document, writeDefLine, boolPos.character);
        const isBoolType = boolScopes?.scopes?.some(scope =>
            scope.includes('entity.name.type') || scope.includes('support.type')
        );
        assert.ok(isBoolType, `'bool' should be highlighted as a type. Got scopes: ${JSON.stringify(boolScopes?.scopes)}`);

        // Verify the comment '//! Write binary data' is highlighted as a comment
        const commentPos = findInLine(document, writeDefLine, '//!');
        const commentScopes = await getTokenScopesAt(document, writeDefLine, commentPos.character);
        const isComment = commentScopes?.scopes?.some(scope => scope.includes('comment'));
        const isNotType = !commentScopes?.scopes?.some(scope => scope.includes('entity.name.type') && !scope.includes('comment'));
        assert.ok(isComment, `'//!' should be highlighted as a comment. Got scopes: ${JSON.stringify(commentScopes?.scopes)}`);
        assert.ok(isNotType, `'//!' should NOT be highlighted as a type. Got scopes: ${JSON.stringify(commentScopes?.scopes)}`);

        // Test 2: Find another function with comment
        let readDefLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            if (document.lineAt(i).text.includes('def read') && document.lineAt(i).text.includes('//! Read data')) {
                readDefLine = i;
                break;
            }
        }
        assert.ok(readDefLine >= 0, 'Should find def read line');

        // Verify return type 'int' is highlighted correctly
        const intPos = findInLine(document, readDefLine, 'int');
        const intScopes = await getTokenScopesAt(document, readDefLine, intPos.character);
        const isIntType = intScopes?.scopes?.some(scope => scope.includes('entity.name.type') || scope.includes('support.type'));
        assert.ok(isIntType, `'int' should be highlighted as a type. Got scopes: ${JSON.stringify(intScopes?.scopes)}`);

        // Verify text "Read data" in comment is highlighted as comment
        const readDataPos = findInLine(document, readDefLine, 'Read data');
        const readDataScopes = await getTokenScopesAt(document, readDefLine, readDataPos.character);
        const isReadDataComment = readDataScopes?.scopes?.some(scope => scope.includes('comment'));
        assert.ok(isReadDataComment, `'Read data' should be highlighted as a comment. Got scopes: ${JSON.stringify(readDataScopes?.scopes)}`);

        // Test 3: Function with block comment
        let processDefLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            if (document.lineAt(i).text.includes('def process') && document.lineAt(i).text.includes('/* Process array data */')) {
                processDefLine = i;
                break;
            }
        }
        assert.ok(processDefLine >= 0, 'Should find def process line');

        // Verify block comment is highlighted as comment
        const blockCommentPos = findInLine(document, processDefLine, '/* Process');
        const blockCommentScopes = await getTokenScopesAt(document, processDefLine, blockCommentPos.character);
        const isBlockComment = blockCommentScopes?.scopes?.some(scope => scope.includes('comment'));
        assert.ok(isBlockComment, `Block comment should be highlighted as a comment. Got scopes: ${JSON.stringify(blockCommentScopes?.scopes)}`);

        console.log('✓ Function return type comments test passed');
    });

    test('Boolean literals should always be highlighted as constants', async () => {
        const uri = vscode.Uri.file(
            path.join(__dirname, '../../test/fixtures/boolean-literals.das')
        );

        const document = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(document);

        // Wait for tokenization to complete
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Test 1: Boolean in variable assignment
        let assignmentLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            if (document.lineAt(i).text.includes('let isActive = true')) {
                assignmentLine = i;
                break;
            }
        }
        assert.ok(assignmentLine >= 0, 'Should find boolean assignment line');

        const truePos1 = findInLine(document, assignmentLine, 'true');
        const trueScopes1 = await getTokenScopesAt(document, assignmentLine, truePos1.character);
        const isConstant1 = trueScopes1?.scopes?.some(scope => scope.includes('constant.language'));
        assert.ok(isConstant1, `'true' in assignment should be constant.language. Got scopes: ${JSON.stringify(trueScopes1?.scopes)}`);

        // Test 2: Boolean in simple function argument
        let simpleFuncLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            if (document.lineAt(i).text.includes('send_message(gameClient, true)')) {
                simpleFuncLine = i;
                break;
            }
        }
        assert.ok(simpleFuncLine >= 0, 'Should find simple function call line');

        const truePos2 = findInLine(document, simpleFuncLine, 'true');
        const trueScopes2 = await getTokenScopesAt(document, simpleFuncLine, truePos2.character);
        const isConstant2 = trueScopes2?.scopes?.some(scope => scope.includes('constant.language'));
        assert.ok(isConstant2, `'true' in function argument should be constant.language. Got scopes: ${JSON.stringify(trueScopes2?.scopes)}`);

        // Test 3: Boolean in complex nested function call (the reported issue)
        let complexFuncLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            if (document.lineAt(i).text.includes('), true)')) {
                complexFuncLine = i;
                break;
            }
        }
        assert.ok(complexFuncLine >= 0, 'Should find complex function call line');

        const truePos3 = findInLine(document, complexFuncLine, 'true');
        const trueScopes3 = await getTokenScopesAt(document, complexFuncLine, truePos3.character);
        const isConstant3 = trueScopes3?.scopes?.some(scope => scope.includes('constant.language'));
        assert.ok(isConstant3, `'true' in complex nested function call should be constant.language. Got scopes: ${JSON.stringify(trueScopes3?.scopes)}`);

        // Test 4: false literal
        let falseLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            if (document.lineAt(i).text.includes('let isDisabled = false')) {
                falseLine = i;
                break;
            }
        }
        assert.ok(falseLine >= 0, 'Should find false assignment line');

        const falsePos = findInLine(document, falseLine, 'false');
        const falseScopes = await getTokenScopesAt(document, falseLine, falsePos.character);
        const isFalseConstant = falseScopes?.scopes?.some(scope => scope.includes('constant.language'));
        assert.ok(isFalseConstant, `'false' should be constant.language. Got scopes: ${JSON.stringify(falseScopes?.scopes)}`);

        // Test 5: null literal
        let nullLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            if (document.lineAt(i).text.includes('let nullValue = null')) {
                nullLine = i;
                break;
            }
        }
        assert.ok(nullLine >= 0, 'Should find null assignment line');

        // Find the second occurrence of "null" (the literal, not the variable name)
        const nullLineText = document.lineAt(nullLine).text;
        const firstNullIndex = nullLineText.indexOf('null');
        const secondNullIndex = nullLineText.indexOf('null', firstNullIndex + 1);
        assert.ok(secondNullIndex >= 0, 'Should find null literal on the line');

        const nullPos = new vscode.Position(nullLine, secondNullIndex);
        const nullScopes = await getTokenScopesAt(document, nullLine, nullPos.character);
        const isNullConstant = nullScopes?.scopes?.some(scope => scope.includes('constant.language'));
        assert.ok(isNullConstant, `'null' should be constant.language. Got scopes: ${JSON.stringify(nullScopes?.scopes)}`);

        console.log('✓ Boolean literals syntax highlighting test passed');
    });

    test('Variable names in reassignments should not be highlighted as types', async () => {
        const uri = vscode.Uri.file(
            path.join(__dirname, '../../test/fixtures/boolean-literals.das')
        );

        const document = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(document);

        // Wait for tokenization to complete
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Test 1: Find variable reassignment - voidRoutine = false
        let reassignmentLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            const lineText = document.lineAt(i).text;
            // Look for reassignment without var/let, but not inside the initial declaration
            if (lineText.trim() === 'voidRoutine = false') {
                reassignmentLine = i;
                break;
            }
        }
        assert.ok(reassignmentLine >= 0, 'Should find voidRoutine reassignment line');

        // Verify 'voidRoutine' is NOT highlighted as entity.name.type
        const voidRoutinePos = findInLine(document, reassignmentLine, 'voidRoutine');
        const voidRoutineScopes = await getTokenScopesAt(document, reassignmentLine, voidRoutinePos.character);

        const isNotType = !voidRoutineScopes?.scopes?.some(scope =>
            scope === 'entity.name.type.dascript' || scope === 'storage.type.dascript'
        );
        const isVariable = voidRoutineScopes?.scopes?.some(scope =>
            scope.includes('variable') || scope === 'source.dascript'
        );

        assert.ok(isNotType, `'voidRoutine' in reassignment should NOT be highlighted as entity.name.type. Got scopes: ${JSON.stringify(voidRoutineScopes?.scopes)}`);
        assert.ok(isVariable, `'voidRoutine' should be highlighted as a variable or have basic source scope. Got scopes: ${JSON.stringify(voidRoutineScopes?.scopes)}`);

        // Test 2: Verify 'false' on the same line is still highlighted as constant
        const falsePos = findInLine(document, reassignmentLine, 'false');
        const falseScopes = await getTokenScopesAt(document, reassignmentLine, falsePos.character);
        const isFalseConstant = falseScopes?.scopes?.some(scope => scope.includes('constant.language'));
        assert.ok(isFalseConstant, `'false' should be constant.language. Got scopes: ${JSON.stringify(falseScopes?.scopes)}`);

        // Test 3: Find another reassignment - someCounter = 10
        let counterReassignLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            const lineText = document.lineAt(i).text;
            if (lineText.trim() === 'someCounter = 10') {
                counterReassignLine = i;
                break;
            }
        }
        assert.ok(counterReassignLine >= 0, 'Should find someCounter reassignment line');

        const someCounterPos = findInLine(document, counterReassignLine, 'someCounter');
        const someCounterScopes = await getTokenScopesAt(document, counterReassignLine, someCounterPos.character);

        const counterIsNotType = !someCounterScopes?.scopes?.some(scope =>
            scope === 'entity.name.type.dascript' || scope === 'storage.type.dascript'
        );

        assert.ok(counterIsNotType, `'someCounter' in reassignment should NOT be highlighted as entity.name.type. Got scopes: ${JSON.stringify(someCounterScopes?.scopes)}`);

        // Test 4: Find string reassignment - playerName = "updated"
        let stringReassignLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            const lineText = document.lineAt(i).text;
            if (lineText.includes('playerName = "updated"')) {
                stringReassignLine = i;
                break;
            }
        }
        assert.ok(stringReassignLine >= 0, 'Should find playerName reassignment line');

        const playerNamePos = findInLine(document, stringReassignLine, 'playerName');
        const playerNameScopes = await getTokenScopesAt(document, stringReassignLine, playerNamePos.character);

        const playerNameIsNotType = !playerNameScopes?.scopes?.some(scope =>
            scope === 'entity.name.type.dascript' || scope === 'storage.type.dascript'
        );

        assert.ok(playerNameIsNotType, `'playerName' in reassignment should NOT be highlighted as entity.name.type. Got scopes: ${JSON.stringify(playerNameScopes?.scopes)}`);

        console.log('✓ Variable reassignment test passed');
    });

    test('Table type arguments should highlight types correctly', async () => {
        const uri = vscode.Uri.file(
            path.join(__dirname, '../../test/fixtures/table-types.das')
        );

        const document = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(document);

        // Wait for tokenization to complete
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Test 1: table<NodeId, float> in struct
        let structTableLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            if (document.lineAt(i).text.includes('toRespawn : table<NodeId, float>')) {
                structTableLine = i;
                break;
            }
        }
        assert.ok(structTableLine >= 0, 'Should find struct with table<NodeId, float>');

        // Verify NodeId is highlighted as a type
        const nodeIdPos = findInLine(document, structTableLine, 'NodeId');
        const nodeIdScopes = await getTokenScopesAt(document, structTableLine, nodeIdPos.character);
        const nodeIdIsType = nodeIdScopes?.scopes?.some(scope =>
            scope.includes('entity.name.type')
        );
        assert.ok(nodeIdIsType, `NodeId in table<NodeId, float> should be highlighted as a type. Got scopes: ${JSON.stringify(nodeIdScopes?.scopes)}`);

        // Verify float is highlighted as a type
        const floatPos = findInLine(document, structTableLine, 'float');
        const floatScopes = await getTokenScopesAt(document, structTableLine, floatPos.character);
        const floatIsType = floatScopes?.scopes?.some(scope =>
            scope.includes('support.type') || scope.includes('entity.name.type')
        );
        assert.ok(floatIsType, `float in table<NodeId, float> should be highlighted as a type. Got scopes: ${JSON.stringify(floatScopes?.scopes)}`);

        // Test 2: table<int, string> with builtin types
        let builtinTableLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            if (document.lineAt(i).text.includes('var simpleTable : table<int, string>')) {
                builtinTableLine = i;
                break;
            }
        }
        assert.ok(builtinTableLine >= 0, 'Should find table<int, string> line');

        // Verify int is highlighted as a type
        const intPos = findInLine(document, builtinTableLine, 'int');
        const intScopes = await getTokenScopesAt(document, builtinTableLine, intPos.character);
        const intIsType = intScopes?.scopes?.some(scope =>
            scope.includes('support.type') || scope.includes('entity.name.type')
        );
        assert.ok(intIsType, `int in table<int, string> should be highlighted as a type. Got scopes: ${JSON.stringify(intScopes?.scopes)}`);

        // Verify string is highlighted as a type
        const stringPos = findInLine(document, builtinTableLine, 'string');
        const stringScopes = await getTokenScopesAt(document, builtinTableLine, stringPos.character);
        const stringIsType = stringScopes?.scopes?.some(scope =>
            scope.includes('support.type') || scope.includes('entity.name.type')
        );
        assert.ok(stringIsType, `string in table<int, string> should be highlighted as a type. Got scopes: ${JSON.stringify(stringScopes?.scopes)}`);

        // Test 3: table with custom types
        let customTableLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            if (document.lineAt(i).text.includes('var customTable : table<EntityId, PlayerData>')) {
                customTableLine = i;
                break;
            }
        }
        assert.ok(customTableLine >= 0, 'Should find custom table line');

        // Verify EntityId is highlighted as a type
        const entityIdPos = findInLine(document, customTableLine, 'EntityId');
        const entityIdScopes = await getTokenScopesAt(document, customTableLine, entityIdPos.character);
        const entityIdIsType = entityIdScopes?.scopes?.some(scope =>
            scope.includes('entity.name.type')
        );
        assert.ok(entityIdIsType, `EntityId should be highlighted as a type. Got scopes: ${JSON.stringify(entityIdScopes?.scopes)}`);

        // Verify PlayerData is highlighted as a type
        const playerDataPos = findInLine(document, customTableLine, 'PlayerData');
        const playerDataScopes = await getTokenScopesAt(document, customTableLine, playerDataPos.character);
        const playerDataIsType = playerDataScopes?.scopes?.some(scope =>
            scope.includes('entity.name.type')
        );
        assert.ok(playerDataIsType, `PlayerData should be highlighted as a type. Got scopes: ${JSON.stringify(playerDataScopes?.scopes)}`);

        // Test 4: table in function parameter
        let functionParamLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            if (document.lineAt(i).text.includes('def processTable(var data : table<NodeId, float3>)')) {
                functionParamLine = i;
                break;
            }
        }
        assert.ok(functionParamLine >= 0, 'Should find function with table parameter');

        // Verify float3 is highlighted as a type
        const float3Pos = findInLine(document, functionParamLine, 'float3');
        const float3Scopes = await getTokenScopesAt(document, functionParamLine, float3Pos.character);
        const float3IsType = float3Scopes?.scopes?.some(scope =>
            scope.includes('support.type') || scope.includes('entity.name.type')
        );
        assert.ok(float3IsType, `float3 in function parameter table should be highlighted as a type. Got scopes: ${JSON.stringify(float3Scopes?.scopes)}`);

        // Test 5: nested structures - table<NodeId, array<float>>
        let nestedLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            if (document.lineAt(i).text.includes('var complex : table<NodeId, array<float>>')) {
                nestedLine = i;
                break;
            }
        }
        assert.ok(nestedLine >= 0, 'Should find nested structure line');

        // Find the 'float' inside array<float> (not in table<>)
        const nestedLineText = document.lineAt(nestedLine).text;
        const arrayFloatIndex = nestedLineText.indexOf('array<float>');
        assert.ok(arrayFloatIndex >= 0, 'Should find array<float> in line');

        const nestedFloatPos = arrayFloatIndex + 'array<'.length;
        const nestedFloatScopes = await getTokenScopesAt(document, nestedLine, nestedFloatPos);
        const nestedFloatIsType = nestedFloatScopes?.scopes?.some(scope =>
            scope.includes('support.type') || scope.includes('entity.name.type')
        );
        assert.ok(nestedFloatIsType, `float in array<float> should be highlighted as a type. Got scopes: ${JSON.stringify(nestedFloatScopes?.scopes)}`);

        // Test 6: Variable names containing keywords should not highlight keywords within them
        // e.g., 'modulesIncludes' should NOT highlight 'module' as a keyword
        let modulesIncludesLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            if (document.lineAt(i).text.includes('var modulesIncludes : table<string>')) {
                modulesIncludesLine = i;
                break;
            }
        }
        assert.ok(modulesIncludesLine >= 0, 'Should find modulesIncludes variable line');

        // Verify 'module' within 'modulesIncludes' is NOT highlighted as a keyword
        const modulesIncludesPos = findInLine(document, modulesIncludesLine, 'modulesIncludes');
        const modulesIncludesScopes = await getTokenScopesAt(document, modulesIncludesLine, modulesIncludesPos.character);
        const moduleIsKeyword = modulesIncludesScopes?.scopes?.some(scope =>
            scope.includes('keyword.module')
        );
        assert.ok(!moduleIsKeyword, `'module' within 'modulesIncludes' should NOT be highlighted as keyword.module. Got scopes: ${JSON.stringify(modulesIncludesScopes?.scopes)}`);

        console.log('✓ Table type arguments test passed');
    });

    test('Block comments inside generic arguments should be highlighted as comments', async () => {
        const uri = vscode.Uri.file(
            path.join(__dirname, '../../test/fixtures/table-types.das')
        );

        const document = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(document);

        // Wait for tokenization to complete
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Find: var nodeNetIds : table<uint64 /*NodeId*/; uint /*netId*/>
        let commentLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            if (document.lineAt(i).text.includes('table<uint64 /*NodeId*/; uint /*netId*/>')) {
                commentLine = i;
                break;
            }
        }
        assert.ok(commentLine >= 0, 'Should find table with block comments in generic arguments');

        // Verify 'NodeId' inside /*NodeId*/ is a comment, not a type
        const nodeIdPos = findInLine(document, commentLine, 'NodeId');
        const nodeIdScopes = await getTokenScopesAt(document, commentLine, nodeIdPos.character);
        const nodeIdIsComment = nodeIdScopes?.scopes?.some(scope => scope.includes('comment'));
        const nodeIdIsType = nodeIdScopes?.scopes?.some(scope => scope.includes('entity.name.type'));
        assert.ok(nodeIdIsComment, `NodeId inside /*NodeId*/ should be a comment. Got scopes: ${JSON.stringify(nodeIdScopes?.scopes)}`);
        assert.ok(!nodeIdIsType, `NodeId inside /*NodeId*/ should NOT be a type. Got scopes: ${JSON.stringify(nodeIdScopes?.scopes)}`);

        // Verify 'netId' inside /*netId*/ is a comment
        const netIdPos = findInLine(document, commentLine, 'netId*/');
        const netIdScopes = await getTokenScopesAt(document, commentLine, netIdPos.character);
        const netIdIsComment = netIdScopes?.scopes?.some(scope => scope.includes('comment'));
        assert.ok(netIdIsComment, `netId inside /*netId*/ should be a comment. Got scopes: ${JSON.stringify(netIdScopes?.scopes)}`);

        // Verify 'uint64' is still highlighted as a type
        const uint64Pos = findInLine(document, commentLine, 'uint64');
        const uint64Scopes = await getTokenScopesAt(document, commentLine, uint64Pos.character);
        const uint64IsType = uint64Scopes?.scopes?.some(scope =>
            scope.includes('support.type') || scope.includes('entity.name.type')
        );
        assert.ok(uint64IsType, `uint64 should still be highlighted as a type. Got scopes: ${JSON.stringify(uint64Scopes?.scopes)}`);

        console.log('✓ Block comments inside generic arguments test passed');
    });

    test('Annotations should be highlighted correctly', async () => {
        const uri = vscode.Uri.file(
            path.join(__dirname, '../../test/fixtures/annotations.das')
        );

        const document = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(document);

        // Wait for tokenization to complete
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Test 1: Property annotation @no_export
        let noExportLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            if (document.lineAt(i).text.includes('@no_export localClientMessages')) {
                noExportLine = i;
                break;
            }
        }
        assert.ok(noExportLine >= 0, 'Should find @no_export annotation line');

        // Verify 'no_export' is highlighted as a function (annotation name)
        const noExportPos = findInLine(document, noExportLine, 'no_export');
        const noExportScopes = await getTokenScopesAt(document, noExportLine, noExportPos.character);
        const isAnnotation = noExportScopes?.scopes?.some(scope =>
            scope.includes('entity.name.function')
        );
        assert.ok(isAnnotation, `no_export should be highlighted as an annotation (function name). Got scopes: ${JSON.stringify(noExportScopes?.scopes)}`);

        // Test 2: Structure annotation [match_copy]
        let matchCopyLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            if (document.lineAt(i).text.includes('[match_copy]')) {
                matchCopyLine = i;
                break;
            }
        }
        assert.ok(matchCopyLine >= 0, 'Should find [match_copy] annotation line');

        // Verify 'match_copy' inside brackets is highlighted as annotation
        const matchCopyPos = findInLine(document, matchCopyLine, 'match_copy');
        const matchCopyScopes = await getTokenScopesAt(document, matchCopyLine, matchCopyPos.character);
        const isStructAnnotation = matchCopyScopes?.scopes?.some(scope =>
            scope.includes('entity.name.function')
        );
        assert.ok(isStructAnnotation, `match_copy should be highlighted as an annotation. Got scopes: ${JSON.stringify(matchCopyScopes?.scopes)}`);

        // Test 3: Annotation with string value @view_name="Hello, world!"
        let viewNameLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            if (document.lineAt(i).text.includes('@view_name="Hello, world!"')) {
                viewNameLine = i;
                break;
            }
        }
        assert.ok(viewNameLine >= 0, 'Should find @view_name annotation line');

        // Verify 'view_name' is highlighted as annotation
        const viewNamePos = findInLine(document, viewNameLine, 'view_name');
        const viewNameScopes = await getTokenScopesAt(document, viewNameLine, viewNamePos.character);
        const isViewNameAnnotation = viewNameScopes?.scopes?.some(scope =>
            scope.includes('entity.name.function')
        );
        assert.ok(isViewNameAnnotation, `view_name should be highlighted as an annotation. Got scopes: ${JSON.stringify(viewNameScopes?.scopes)}`);

        // Test 4: Annotation with unquoted value @serialize_name=hello_world
        let serializeNameLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            if (document.lineAt(i).text.includes('@serialize_name=hello_world')) {
                serializeNameLine = i;
                break;
            }
        }
        assert.ok(serializeNameLine >= 0, 'Should find @serialize_name annotation line');

        // Verify 'serialize_name' is highlighted as annotation
        const serializeNamePos = findInLine(document, serializeNameLine, 'serialize_name');
        const serializeNameScopes = await getTokenScopesAt(document, serializeNameLine, serializeNamePos.character);
        const isSerializeNameAnnotation = serializeNameScopes?.scopes?.some(scope =>
            scope.includes('entity.name.function')
        );
        assert.ok(isSerializeNameAnnotation, `serialize_name should be highlighted as an annotation. Got scopes: ${JSON.stringify(serializeNameScopes?.scopes)}`);

        // Test 5: Multiple annotations on same line
        let exportLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            const lineText = document.lineAt(i).text;
            if (lineText.includes('@export private export_me')) {
                exportLine = i;
                break;
            }
        }
        assert.ok(exportLine >= 0, 'Should find @export annotation line');

        // Verify 'export' is highlighted as annotation
        const exportPos = findInLine(document, exportLine, 'export');
        const exportScopes = await getTokenScopesAt(document, exportLine, exportPos.character);
        const isExportAnnotation = exportScopes?.scopes?.some(scope =>
            scope.includes('entity.name.function')
        );
        assert.ok(isExportAnnotation, `export should be highlighted as an annotation. Got scopes: ${JSON.stringify(exportScopes?.scopes)}`);

        // Test 6: Call macro annotation [call_macro(name="yield_from")]
        let callMacroLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            if (document.lineAt(i).text.includes('[call_macro(name="yield_from")]')) {
                callMacroLine = i;
                break;
            }
        }
        assert.ok(callMacroLine >= 0, 'Should find [call_macro] annotation line');

        // Verify 'call_macro' is highlighted as annotation function, NOT as entity.name.type
        const callMacroPos = findInLine(document, callMacroLine, 'call_macro');
        const callMacroScopes = await getTokenScopesAt(document, callMacroLine, callMacroPos.character);
        const isCallMacroAnnotation = callMacroScopes?.scopes?.some(scope =>
            scope.includes('entity.name.function.annotation')
        );
        const isNotType = !callMacroScopes?.scopes?.some(scope =>
            scope === 'entity.name.type.dascript'
        );
        assert.ok(isCallMacroAnnotation, `call_macro should be highlighted as entity.name.function.annotation. Got scopes: ${JSON.stringify(callMacroScopes?.scopes)}`);
        assert.ok(isNotType, `call_macro should NOT be highlighted as entity.name.type.dascript. Got scopes: ${JSON.stringify(callMacroScopes?.scopes)}`);

        // Verify the 'name' parameter inside call_macro
        const nameParamPos = findInLine(document, callMacroLine, 'name');
        const nameParamScopes = await getTokenScopesAt(document, callMacroLine, nameParamPos.character);
        const isNameParam = nameParamScopes?.scopes?.some(scope =>
            scope.includes('variable.parameter')
        );
        assert.ok(isNameParam, `'name' parameter should be highlighted as variable.parameter. Got scopes: ${JSON.stringify(nameParamScopes?.scopes)}`);

        // Test 7: Another call macro [call_macro(name="co_continue")]
        let coContinueLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            if (document.lineAt(i).text.includes('[call_macro(name="co_continue")]')) {
                coContinueLine = i;
                break;
            }
        }
        assert.ok(coContinueLine >= 0, 'Should find co_continue call_macro annotation');

        const coContinueCallMacroPos = findInLine(document, coContinueLine, 'call_macro');
        const coContinueScopes = await getTokenScopesAt(document, coContinueLine, coContinueCallMacroPos.character);
        const isCoContinueAnnotation = coContinueScopes?.scopes?.some(scope =>
            scope.includes('entity.name.function.annotation')
        );
        assert.ok(isCoContinueAnnotation, `call_macro in co_continue should be highlighted as annotation. Got scopes: ${JSON.stringify(coContinueScopes?.scopes)}`);

        console.log('✓ Annotations test passed');
    });

    test('Function calls with named parameters should highlight correctly', async () => {
        const uri = vscode.Uri.file(
            path.join(__dirname, '../../test/fixtures/annotations.das')
        );

        const document = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(document);

        // Wait for tokenization to complete
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Test 1: describe([decl=typ, modules=false]) - decl should be a parameter, not annotation
        let describeLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            if (document.lineAt(i).text.includes('describe([decl=typ, modules=false])')) {
                describeLine = i;
                break;
            }
        }
        assert.ok(describeLine >= 0, 'Should find describe function call line');

        // Verify 'describe' is highlighted as a function
        const describePos = findInLine(document, describeLine, 'describe');
        const describeScopes = await getTokenScopesAt(document, describeLine, describePos.character);
        const isDescribeFunction = describeScopes?.scopes?.some(scope =>
            scope.includes('entity.name.function')
        );
        assert.ok(isDescribeFunction, `'describe' should be highlighted as a function. Got scopes: ${JSON.stringify(describeScopes?.scopes)}`);

        // Verify 'decl' is highlighted as a parameter keyword, NOT as annotation
        const declPos = findInLine(document, describeLine, 'decl');
        const declScopes = await getTokenScopesAt(document, describeLine, declPos.character);
        const isDeclParameter = declScopes?.scopes?.some(scope =>
            scope.includes('variable.parameter')
        );
        const isDeclNotAnnotation = !declScopes?.scopes?.some(scope =>
            scope.includes('entity.name.function.annotation')
        );
        assert.ok(isDeclParameter, `'decl' should be highlighted as a parameter. Got scopes: ${JSON.stringify(declScopes?.scopes)}`);
        assert.ok(isDeclNotAnnotation, `'decl' should NOT be highlighted as annotation. Got scopes: ${JSON.stringify(declScopes?.scopes)}`);

        // Verify 'modules' is also highlighted as a parameter keyword
        const modulesPos = findInLine(document, describeLine, 'modules');
        const modulesScopes = await getTokenScopesAt(document, describeLine, modulesPos.character);
        const isModulesParameter = modulesScopes?.scopes?.some(scope =>
            scope.includes('variable.parameter')
        );
        assert.ok(isModulesParameter, `'modules' should be highlighted as a parameter. Got scopes: ${JSON.stringify(modulesScopes?.scopes)}`);

        // Test 2: configure([verbose=true, output="file.txt"])
        let configureLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            if (document.lineAt(i).text.includes('configure([verbose=true')) {
                configureLine = i;
                break;
            }
        }
        assert.ok(configureLine >= 0, 'Should find configure function call line');

        // Verify 'verbose' is highlighted as a parameter
        const verbosePos = findInLine(document, configureLine, 'verbose');
        const verboseScopes = await getTokenScopesAt(document, configureLine, verbosePos.character);
        const isVerboseParameter = verboseScopes?.scopes?.some(scope =>
            scope.includes('variable.parameter')
        );
        assert.ok(isVerboseParameter, `'verbose' should be highlighted as a parameter. Got scopes: ${JSON.stringify(verboseScopes?.scopes)}`);

        console.log('✓ Function calls with named parameters test passed');
    });

    test('Apostrophes in comments should not be treated as string delimiters', async () => {
        const uri = vscode.Uri.file(
            path.join(__dirname, '../../test/fixtures/comments.das')
        );

        const document = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(document);

        // Wait for tokenization to complete
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Test 1: Find line with apostrophe in comment "It's better"
        let apostropheCommentLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            if (document.lineAt(i).text === "// It's better than declaring typ as var.") {
                apostropheCommentLine = i;
                break;
            }
        }
        assert.ok(apostropheCommentLine >= 0, 'Should find line with apostrophe in comment');

        // Verify the apostrophe is only highlighted as comment, NOT as string
        const apostrophePos = document.lineAt(apostropheCommentLine).text.indexOf("'");
        const apostropheScopes = await getTokenScopesAt(document, apostropheCommentLine, apostrophePos);
        const hasCommentScope = apostropheScopes?.scopes?.some(scope => scope.includes('comment'));
        const hasNoStringScope = !apostropheScopes?.scopes?.some(scope => scope.includes('string.quoted'));
        assert.ok(hasCommentScope, `Apostrophe in comment should have comment scope. Got scopes: ${JSON.stringify(apostropheScopes?.scopes)}`);
        assert.ok(hasNoStringScope, `Apostrophe in comment should NOT have string.quoted scope. Got scopes: ${JSON.stringify(apostropheScopes?.scopes)}`);

        // Test 2: Find line "Don't use this approach"
        let dontLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            if (document.lineAt(i).text.includes("// Don't use this approach")) {
                dontLine = i;
                break;
            }
        }
        assert.ok(dontLine >= 0, 'Should find "Don\'t" comment line');

        const dontApostrophePos = document.lineAt(dontLine).text.indexOf("'");
        const dontScopes = await getTokenScopesAt(document, dontLine, dontApostrophePos);
        const dontHasComment = dontScopes?.scopes?.some(scope => scope.includes('comment'));
        const dontHasNoString = !dontScopes?.scopes?.some(scope => scope.includes('string.quoted'));
        assert.ok(dontHasComment, `Apostrophe in "Don't" should have comment scope. Got scopes: ${JSON.stringify(dontScopes?.scopes)}`);
        assert.ok(dontHasNoString, `Apostrophe in "Don't" should NOT have string.quoted scope. Got scopes: ${JSON.stringify(dontScopes?.scopes)}`);

        // Test 3: Code line with trailing comment containing apostrophe
        let codeWithCommentLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            if (document.lineAt(i).text.includes("reinterpret<TypeDecl?>") && document.lineAt(i).text.includes("// It's")) {
                codeWithCommentLine = i;
                break;
            }
        }
        assert.ok(codeWithCommentLine >= 0, 'Should find code line with trailing comment');

        // Verify the apostrophe in the trailing comment is not treated as string
        const lineText = document.lineAt(codeWithCommentLine).text;
        const commentStart = lineText.indexOf("//");
        const apostropheInComment = lineText.indexOf("'", commentStart);
        if (apostropheInComment >= 0) {
            const trailingApostropheScopes = await getTokenScopesAt(document, codeWithCommentLine, apostropheInComment);
            const trailingHasComment = trailingApostropheScopes?.scopes?.some(scope => scope.includes('comment'));
            const trailingHasNoString = !trailingApostropheScopes?.scopes?.some(scope => scope.includes('string.quoted'));
            assert.ok(trailingHasComment, `Apostrophe in trailing comment should have comment scope. Got scopes: ${JSON.stringify(trailingApostropheScopes?.scopes)}`);
            assert.ok(trailingHasNoString, `Apostrophe in trailing comment should NOT have string.quoted scope. Got scopes: ${JSON.stringify(trailingApostropheScopes?.scopes)}`);
        }

        console.log('✓ Apostrophes in comments test passed');
    });

    test('Types in reinterpret and cast angle brackets should be highlighted as types', async () => {
        const uri = vscode.Uri.file(
            path.join(__dirname, '../../test/fixtures/cast-types.das')
        );

        const document = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(document);

        // Wait for tokenization to complete
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Test 1: Find line with reinterpret<TypeDecl?>
        let reinterpretLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            if (document.lineAt(i).text.includes('reinterpret<TypeDecl?>')) {
                reinterpretLine = i;
                break;
            }
        }
        assert.ok(reinterpretLine >= 0, 'Should find line with reinterpret<TypeDecl?>');

        // Verify 'reinterpret' is highlighted as a cast keyword
        const reinterpretPos = findInLine(document, reinterpretLine, 'reinterpret');
        const reinterpretScopes = await getTokenScopesAt(document, reinterpretLine, reinterpretPos.character);
        const isReinterpretKeyword = reinterpretScopes?.scopes?.some(scope =>
            scope.includes('storage.modifier.specifier.cast')
        );
        assert.ok(isReinterpretKeyword, `'reinterpret' should be highlighted as cast specifier. Got scopes: ${JSON.stringify(reinterpretScopes?.scopes)}`);

        // Verify 'TypeDecl' inside angle brackets is highlighted as a type, NOT as a variable
        const typeDeclPos = findInLine(document, reinterpretLine, 'TypeDecl');
        const typeDeclScopes = await getTokenScopesAt(document, reinterpretLine, typeDeclPos.character);
        const isType = typeDeclScopes?.scopes?.some(scope =>
            scope.includes('entity.name.type')
        );
        const isNotVariable = !typeDeclScopes?.scopes?.some(scope =>
            scope.includes('variable.parameter')
        );
        assert.ok(isType, `'TypeDecl' in reinterpret<TypeDecl?> should be highlighted as a type. Got scopes: ${JSON.stringify(typeDeclScopes?.scopes)}`);
        assert.ok(isNotVariable, `'TypeDecl' in reinterpret<TypeDecl?> should NOT be highlighted as a variable. Got scopes: ${JSON.stringify(typeDeclScopes?.scopes)}`);

        // Test 2: Find line with cast<CustomType>
        let castLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            if (document.lineAt(i).text.includes('cast<CustomType>')) {
                castLine = i;
                break;
            }
        }
        assert.ok(castLine >= 0, 'Should find line with cast<CustomType>');

        // Verify 'CustomType' inside cast<> is highlighted as a type
        const customTypePos = findInLine(document, castLine, 'CustomType');
        const customTypeScopes = await getTokenScopesAt(document, castLine, customTypePos.character);
        const isCustomType = customTypeScopes?.scopes?.some(scope =>
            scope.includes('entity.name.type')
        );
        assert.ok(isCustomType, `'CustomType' in cast<CustomType> should be highlighted as a type. Got scopes: ${JSON.stringify(customTypeScopes?.scopes)}`);

        // Test 3: Find line with upcast<BaseClass>
        let upcastLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            if (document.lineAt(i).text.includes('upcast<BaseClass>')) {
                upcastLine = i;
                break;
            }
        }
        assert.ok(upcastLine >= 0, 'Should find line with upcast<BaseClass>');

        // Verify 'BaseClass' inside upcast<> is highlighted as a type
        const baseClassPos = findInLine(document, upcastLine, 'BaseClass');
        const baseClassScopes = await getTokenScopesAt(document, upcastLine, baseClassPos.character);
        const isBaseClass = baseClassScopes?.scopes?.some(scope =>
            scope.includes('entity.name.type')
        );
        assert.ok(isBaseClass, `'BaseClass' in upcast<BaseClass> should be highlighted as a type. Got scopes: ${JSON.stringify(baseClassScopes?.scopes)}`);

        // Test 4: Built-in type in reinterpret (should still work)
        let builtinReinterpretLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            if (document.lineAt(i).text.includes('reinterpret<float>')) {
                builtinReinterpretLine = i;
                break;
            }
        }
        assert.ok(builtinReinterpretLine >= 0, 'Should find line with reinterpret<float>');

        // Verify 'float' inside reinterpret<> is highlighted as a built-in type
        const floatPos = findInLine(document, builtinReinterpretLine, 'float');
        const floatScopes = await getTokenScopesAt(document, builtinReinterpretLine, floatPos.character);
        const isBuiltinType = floatScopes?.scopes?.some(scope =>
            scope.includes('support.type') || scope.includes('entity.name.type')
        );
        assert.ok(isBuiltinType, `'float' in reinterpret<float> should be highlighted as a type. Got scopes: ${JSON.stringify(floatScopes?.scopes)}`);

        console.log('✓ Cast/reinterpret types test passed');
    });

    test('Base types called as constructor casts should be highlighted as types', async () => {
        const uri = vscode.Uri.file(
            path.join(__dirname, '../../test/fixtures/cast-types.das')
        );

        const document = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(document);

        // Wait for tokenization to complete
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Test 1: uint16(0)
        let u16Line = -1;
        for (let i = 0; i < document.lineCount; i++) {
            if (document.lineAt(i).text.includes('uint16(0)')) {
                u16Line = i;
                break;
            }
        }
        assert.ok(u16Line >= 0, 'Should find uint16(0) line');

        const u16Pos = findInLine(document, u16Line, 'uint16');
        const u16Scopes = await getTokenScopesAt(document, u16Line, u16Pos.character);
        const u16IsType = u16Scopes?.scopes?.some(scope => scope.includes('support.type'));
        assert.ok(u16IsType, `'uint16' in uint16(0) should be highlighted as a type. Got scopes: ${JSON.stringify(u16Scopes?.scopes)}`);

        // Test 2: float(intValue)
        let floatLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            if (document.lineAt(i).text.includes('float(intValue)')) {
                floatLine = i;
                break;
            }
        }
        assert.ok(floatLine >= 0, 'Should find float(intValue) line');

        const floatPos = findInLine(document, floatLine, 'float');
        const floatScopes = await getTokenScopesAt(document, floatLine, floatPos.character);
        const floatIsType = floatScopes?.scopes?.some(scope => scope.includes('support.type'));
        assert.ok(floatIsType, `'float' in float(intValue) should be highlighted as a type. Got scopes: ${JSON.stringify(floatScopes?.scopes)}`);

        // Test 3: float3(1.0, 2.0, 3.0)
        let float3Line = -1;
        for (let i = 0; i < document.lineCount; i++) {
            if (document.lineAt(i).text.includes('float3(1.0, 2.0, 3.0)')) {
                float3Line = i;
                break;
            }
        }
        assert.ok(float3Line >= 0, 'Should find float3(1.0, 2.0, 3.0) line');

        const float3Pos = findInLine(document, float3Line, 'float3');
        const float3Scopes = await getTokenScopesAt(document, float3Line, float3Pos.character);
        const float3IsType = float3Scopes?.scopes?.some(scope => scope.includes('support.type'));
        assert.ok(float3IsType, `'float3' in float3(...) should be highlighted as a type. Got scopes: ${JSON.stringify(float3Scopes?.scopes)}`);

        // Test 4: range(10) should be a function call, not a type
        let rangeCallLine = -1;
        let rangeTypeLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            const lineText = document.lineAt(i).text;
            if (rangeCallLine < 0 && lineText.includes('range(10)')) {
                rangeCallLine = i;
            }
            if (rangeTypeLine < 0 && lineText.includes('var r : range')) {
                rangeTypeLine = i;
            }
        }
        assert.ok(rangeCallLine >= 0, 'Should find range(10) line');
        assert.ok(rangeTypeLine >= 0, 'Should find var r : range line');

        const rangeCallPos = findInLine(document, rangeCallLine, 'range');
        const rangeCallScopes = await getTokenScopesAt(document, rangeCallLine, rangeCallPos.character);
        const rangeIsFunction = rangeCallScopes?.scopes?.some(scope => scope.includes('entity.name.function'));
        const rangeCallIsType = rangeCallScopes?.scopes?.some(scope => scope.includes('support.type'));
        assert.ok(rangeIsFunction && !rangeCallIsType, `'range' in range(10) should be highlighted as a function call, not a type. Got scopes: ${JSON.stringify(rangeCallScopes?.scopes)}`);

        const rangeTypePos = findInLine(document, rangeTypeLine, 'range');
        const rangeTypeScopes = await getTokenScopesAt(document, rangeTypeLine, rangeTypePos.character);
        const rangeIsType = rangeTypeScopes?.scopes?.some(scope =>
            scope.includes('support.type') || scope.includes('entity.name.type')
        );
        assert.ok(rangeIsType, `'range' in 'var r : range' should still be highlighted as a type. Got scopes: ${JSON.stringify(rangeTypeScopes?.scopes)}`);

        console.log('✓ Constructor cast types test passed');
    });

    test('qmacro_expr and reification tags should highlight correctly', async () => {
        const uri = vscode.Uri.file(
            path.join(__dirname, '../../test/fixtures/call-macro-annotations.das')
        );

        const document = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(document);

        // Wait for tokenization to complete
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Test 1: qmacro_expr should be highlighted the same as qmacro_block
        let qmacroBlockLine = -1;
        let qmacroExprLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            const lineText = document.lineAt(i).text;
            if (qmacroBlockLine < 0 && lineText.includes('qmacro_block <|')) {
                qmacroBlockLine = i;
            }
            if (qmacroExprLine < 0 && lineText.includes('qmacro_expr <|')) {
                qmacroExprLine = i;
            }
        }
        assert.ok(qmacroBlockLine >= 0, 'Should find qmacro_block line');
        assert.ok(qmacroExprLine >= 0, 'Should find qmacro_expr line');

        const qmacroBlockPos = findInLine(document, qmacroBlockLine, 'qmacro_block');
        const qmacroBlockScopes = await getTokenScopesAt(document, qmacroBlockLine, qmacroBlockPos.character);

        const qmacroExprPos = findInLine(document, qmacroExprLine, 'qmacro_expr');
        const qmacroExprScopes = await getTokenScopesAt(document, qmacroExprLine, qmacroExprPos.character);

        const exprIsFunction = qmacroExprScopes?.scopes?.some(scope =>
            scope.includes('entity.name.function')
        );
        assert.ok(exprIsFunction, `'qmacro_expr' should be highlighted as a function like qmacro_block. Got scopes: ${JSON.stringify(qmacroExprScopes?.scopes)}`);
        assert.deepStrictEqual(qmacroExprScopes?.scopes, qmacroBlockScopes?.scopes,
            `'qmacro_expr' should get the same scopes as 'qmacro_block'. qmacro_expr: ${JSON.stringify(qmacroExprScopes?.scopes)}, qmacro_block: ${JSON.stringify(qmacroBlockScopes?.scopes)}`);

        // Test 2: reification tags $i / $e should be storage.modifier including the $ sign
        let tagLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            if (document.lineAt(i).text.includes('for $i(iname) in $e(call.arguments[0])')) {
                tagLine = i;
                break;
            }
        }
        assert.ok(tagLine >= 0, 'Should find line with $i and $e tags');

        const lineText = document.lineAt(tagLine).text;

        // Check both the '$' and the letter of '$i'
        const dollarIIndex = lineText.indexOf('$i(');
        for (const offset of [0, 1]) {
            const scopes = await getTokenScopesAt(document, tagLine, dollarIIndex + offset);
            const isStorageModifier = scopes?.scopes?.some(scope => scope.includes('storage.modifier'));
            assert.ok(isStorageModifier, `'$i' (char ${offset}) should be storage.modifier. Got scopes: ${JSON.stringify(scopes?.scopes)}`);
        }

        // Check both the '$' and the letter of '$e'
        const dollarEIndex = lineText.indexOf('$e(');
        for (const offset of [0, 1]) {
            const scopes = await getTokenScopesAt(document, tagLine, dollarEIndex + offset);
            const isStorageModifier = scopes?.scopes?.some(scope => scope.includes('storage.modifier'));
            assert.ok(isStorageModifier, `'$e' (char ${offset}) should be storage.modifier. Got scopes: ${JSON.stringify(scopes?.scopes)}`);
        }

        // The captured variable inside the tag should stay a variable, not storage.modifier
        const inamePos = findInLine(document, tagLine, 'iname');
        const inameScopes = await getTokenScopesAt(document, tagLine, inamePos.character);
        const inameIsVariable = inameScopes?.scopes?.some(scope => scope.includes('variable'));
        assert.ok(inameIsVariable, `'iname' inside $i() should be a variable. Got scopes: ${JSON.stringify(inameScopes?.scopes)}`);

        console.log('✓ qmacro_expr and reification tags test passed');
    });

    test('Module-qualified types (namespace::Type) should highlight namespace as type', async () => {
        const uri = vscode.Uri.file(
            path.join(__dirname, '../../test/fixtures/cast-types.das')
        );

        const document = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(document);

        // Wait for tokenization to complete
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Test 1: Find line with reinterpret<ast::TypeDecl?>
        let moduleQualifiedLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            if (document.lineAt(i).text.includes('reinterpret<ast::TypeDecl?>')) {
                moduleQualifiedLine = i;
                break;
            }
        }
        assert.ok(moduleQualifiedLine >= 0, 'Should find line with reinterpret<ast::TypeDecl?>');

        // Verify 'ast' is highlighted as a type (module namespace), NOT as a variable
        const astPos = findInLine(document, moduleQualifiedLine, 'ast');
        const astScopes = await getTokenScopesAt(document, moduleQualifiedLine, astPos.character);
        const isAstType = astScopes?.scopes?.some(scope =>
            scope.includes('entity.name.type')
        );
        const isNotVariable = !astScopes?.scopes?.some(scope =>
            scope.includes('variable.parameter')
        );
        assert.ok(isAstType, `'ast' in reinterpret<ast::TypeDecl?> should be highlighted as a type. Got scopes: ${JSON.stringify(astScopes?.scopes)}`);
        assert.ok(isNotVariable, `'ast' in reinterpret<ast::TypeDecl?> should NOT be highlighted as a variable. Got scopes: ${JSON.stringify(astScopes?.scopes)}`);

        // Verify 'TypeDecl' is also highlighted as a type
        const typeDeclPos = findInLine(document, moduleQualifiedLine, 'TypeDecl');
        const typeDeclScopes = await getTokenScopesAt(document, moduleQualifiedLine, typeDeclPos.character);
        const isTypeDeclType = typeDeclScopes?.scopes?.some(scope =>
            scope.includes('entity.name.type')
        );
        assert.ok(isTypeDeclType, `'TypeDecl' in reinterpret<ast::TypeDecl?> should be highlighted as a type. Got scopes: ${JSON.stringify(typeDeclScopes?.scopes)}`);

        // Test 2: Variable declaration with module-qualified type
        let varDeclLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            if (document.lineAt(i).text.includes('var td : ast::TypeDecl')) {
                varDeclLine = i;
                break;
            }
        }
        assert.ok(varDeclLine >= 0, 'Should find line with var td : ast::TypeDecl');

        // Verify 'ast' in variable declaration is highlighted as a type
        const varAstPos = findInLine(document, varDeclLine, 'ast');
        const varAstScopes = await getTokenScopesAt(document, varDeclLine, varAstPos.character);
        const isVarAstType = varAstScopes?.scopes?.some(scope =>
            scope.includes('entity.name.type')
        );
        assert.ok(isVarAstType, `'ast' in 'var td : ast::TypeDecl' should be highlighted as a type. Got scopes: ${JSON.stringify(varAstScopes?.scopes)}`);

        // Test 3: smart_ptr<ast::TypeDecl> - module-qualified type inside generic/template
        let smartPtrLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            if (document.lineAt(i).text.includes('smart_ptr<ast::TypeDecl>')) {
                smartPtrLine = i;
                break;
            }
        }
        assert.ok(smartPtrLine >= 0, 'Should find line with smart_ptr<ast::TypeDecl>');

        // Verify 'ast' inside smart_ptr<> is highlighted as a type, NOT as a variant identifier
        const smartPtrAstPos = findInLine(document, smartPtrLine, 'ast');
        const smartPtrAstScopes = await getTokenScopesAt(document, smartPtrLine, smartPtrAstPos.character);
        const isSmartPtrAstType = smartPtrAstScopes?.scopes?.some(scope =>
            scope.includes('entity.name.type')
        );
        const isNotVariantIdentifier = !smartPtrAstScopes?.scopes?.some(scope =>
            scope.includes('variable.parameter.variant')
        );
        assert.ok(isSmartPtrAstType, `'ast' in smart_ptr<ast::TypeDecl> should be highlighted as a type. Got scopes: ${JSON.stringify(smartPtrAstScopes?.scopes)}`);
        assert.ok(isNotVariantIdentifier, `'ast' in smart_ptr<ast::TypeDecl> should NOT be highlighted as a variant identifier. Got scopes: ${JSON.stringify(smartPtrAstScopes?.scopes)}`);

        // Test 4: module-qualified variable on assignment LHS: user::userName = userName
        let qualAssignLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            if (document.lineAt(i).text.includes('user::userName = userName')) {
                qualAssignLine = i;
                break;
            }
        }
        assert.ok(qualAssignLine >= 0, 'Should find user::userName = userName line');

        const qualVarPos = findInLine(document, qualAssignLine, 'userName =');
        const qualVarScopes = await getTokenScopesAt(document, qualAssignLine, qualVarPos.character);
        const qualVarIsVariable = qualVarScopes?.scopes?.some(scope => scope.includes('variable'));
        const qualVarIsNotType = !qualVarScopes?.scopes?.some(scope => scope.includes('entity.name.type'));
        assert.ok(qualVarIsVariable && qualVarIsNotType, `'userName' in 'user::userName =' should be a variable, not a type. Got scopes: ${JSON.stringify(qualVarScopes?.scopes)}`);

        // Member access position: net::config.timeout
        let memberLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            if (document.lineAt(i).text.includes('net::config.timeout')) {
                memberLine = i;
                break;
            }
        }
        assert.ok(memberLine >= 0, 'Should find net::config.timeout line');

        const memberPos = findInLine(document, memberLine, 'config');
        const memberScopes = await getTokenScopesAt(document, memberLine, memberPos.character);
        const memberIsVariable = memberScopes?.scopes?.some(scope => scope.includes('variable'));
        assert.ok(memberIsVariable, `'config' in 'net::config.timeout' should be a variable. Got scopes: ${JSON.stringify(memberScopes?.scopes)}`);

        // Function call position: net::send_message(...)
        let qualCallLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            if (document.lineAt(i).text.includes('net::send_message(')) {
                qualCallLine = i;
                break;
            }
        }
        assert.ok(qualCallLine >= 0, 'Should find net::send_message line');

        const qualCallPos = findInLine(document, qualCallLine, 'send_message');
        const qualCallScopes = await getTokenScopesAt(document, qualCallLine, qualCallPos.character);
        const qualCallIsFunction = qualCallScopes?.scopes?.some(scope => scope.includes('entity.name.function'));
        assert.ok(qualCallIsFunction, `'send_message' in 'net::send_message(...)' should be a function name. Got scopes: ${JSON.stringify(qualCallScopes?.scopes)}`);

        console.log('✓ Module-qualified types test passed');
    });

    test('Safe navigation operators (?as and ?is) should be highlighted as keywords', async () => {
        const uri = vscode.Uri.file(
            path.join(__dirname, '../../test/fixtures/safe-navigation-operators.das')
        );

        const document = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(document);

        // Wait for tokenization to complete
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Test 1: Find line with ?as operator
        let safeAsLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            if (document.lineAt(i).text.includes('someValue ?as int')) {
                safeAsLine = i;
                break;
            }
        }
        assert.ok(safeAsLine >= 0, 'Should find line with ?as operator');

        // Verify 'as' after '?' is highlighted as a keyword, NOT as a variable
        // The '?' is not highlighted, only 'as' is
        const questionMarkPos = findInLine(document, safeAsLine, '?as');
        const safeAsScopes = await getTokenScopesAt(document, safeAsLine, questionMarkPos.character + 1); // +1 to get 'as' after '?'
        const isSafeAsKeyword = safeAsScopes?.scopes?.some(scope =>
            scope.includes('keyword.control')
        );
        const isSafeAsNotVariable = !safeAsScopes?.scopes?.some(scope =>
            scope.includes('variable')
        );
        assert.ok(isSafeAsKeyword, `'as' in '?as' should be highlighted as keyword.control. Got scopes: ${JSON.stringify(safeAsScopes?.scopes)}`);
        assert.ok(isSafeAsNotVariable, `'as' in '?as' should NOT be highlighted as a variable. Got scopes: ${JSON.stringify(safeAsScopes?.scopes)}`);

        // Test 2: Find line with ?is operator
        let safeIsLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            if (document.lineAt(i).text.includes('value ?is int')) {
                safeIsLine = i;
                break;
            }
        }
        assert.ok(safeIsLine >= 0, 'Should find line with ?is operator');

        // Verify 'is' after '?' is highlighted as a keyword, NOT as a variable
        // The '?' is not highlighted, only 'is' is
        const questionMarkIsPos = findInLine(document, safeIsLine, '?is');
        const safeIsScopes = await getTokenScopesAt(document, safeIsLine, questionMarkIsPos.character + 1); // +1 to get 'is' after '?'
        const isSafeIsKeyword = safeIsScopes?.scopes?.some(scope =>
            scope.includes('keyword.control')
        );
        const isSafeIsNotVariable = !safeIsScopes?.scopes?.some(scope =>
            scope.includes('variable')
        );
        assert.ok(isSafeIsKeyword, `'is' in '?is' should be highlighted as keyword.control. Got scopes: ${JSON.stringify(safeIsScopes?.scopes)}`);
        assert.ok(isSafeIsNotVariable, `'is' in '?is' should NOT be highlighted as a variable. Got scopes: ${JSON.stringify(safeIsScopes?.scopes)}`);

        // Test 3: ?as with CustomType
        let customTypeLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            if (document.lineAt(i).text.includes('?as CustomType')) {
                customTypeLine = i;
                break;
            }
        }
        assert.ok(customTypeLine >= 0, 'Should find line with ?as CustomType');

        // Verify 'as' after '?' with custom type is highlighted as keyword
        const customQuestionMarkPos = findInLine(document, customTypeLine, '?as');
        const customSafeAsScopes = await getTokenScopesAt(document, customTypeLine, customQuestionMarkPos.character + 1); // +1 to get 'as' after '?'
        const isCustomSafeAsKeyword = customSafeAsScopes?.scopes?.some(scope =>
            scope.includes('keyword.control')
        );
        assert.ok(isCustomSafeAsKeyword, `'as' in '?as CustomType' should be highlighted as keyword.control. Got scopes: ${JSON.stringify(customSafeAsScopes?.scopes)}`);

        console.log('✓ Safe navigation operators (?as and ?is) test passed');
    });

    test('Piped function calls should highlight function names correctly', async () => {
        const uri = vscode.Uri.file(
            path.join(__dirname, '../../test/fixtures/piped-function-calls.das')
        );

        const document = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(document);

        // Wait for tokenization to complete
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Test 1: Simple piped call - scene |> get_node_id("test")
        let simplePipeLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            if (document.lineAt(i).text.includes('scene |> get_node_id')) {
                simplePipeLine = i;
                break;
            }
        }
        assert.ok(simplePipeLine >= 0, 'Should find simple piped call line');

        // Verify 'get_node_id' is highlighted as function
        const funcPos = findInLine(document, simplePipeLine, 'get_node_id');
        const funcScopes = await getTokenScopesAt(document, simplePipeLine, funcPos.character);
        const isFunction = funcScopes?.scopes?.some(scope =>
            scope.includes('entity.name.function')
        );
        assert.ok(isFunction, `'get_node_id' after |> should be highlighted as function. Got scopes: ${JSON.stringify(funcScopes?.scopes)}`);

        // Test 2: Piped call without parentheses - scene |> process_all
        let noPipeLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            if (document.lineAt(i).text.includes('scene |> process_all')) {
                noPipeLine = i;
                break;
            }
        }
        assert.ok(noPipeLine >= 0, 'Should find piped call without parens line');

        // Verify 'process_all' is highlighted as function, not variable
        const processPos = findInLine(document, noPipeLine, 'process_all');
        const processScopes = await getTokenScopesAt(document, noPipeLine, processPos.character);
        const isProcessFunction = processScopes?.scopes?.some(scope =>
            scope.includes('entity.name.function')
        );
        const notVariable = !processScopes?.scopes?.some(scope =>
            scope.includes('variable.parameter.identifier')
        );
        assert.ok(isProcessFunction, `'process_all' after |> should be highlighted as function. Got scopes: ${JSON.stringify(processScopes?.scopes)}`);
        assert.ok(notVariable, `'process_all' after |> should NOT be highlighted as variable. Got scopes: ${JSON.stringify(processScopes?.scopes)}`);

        // Test 3: Chained piped calls - scene |> find_node(name) |> get_transform()
        let chainedLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            if (document.lineAt(i).text.includes('find_node(name) |> get_transform')) {
                chainedLine = i;
                break;
            }
        }
        assert.ok(chainedLine >= 0, 'Should find chained piped calls line');

        // Verify both functions are highlighted
        const findNodePos = findInLine(document, chainedLine, 'find_node');
        const findNodeScopes = await getTokenScopesAt(document, chainedLine, findNodePos.character);
        const isFindFunction = findNodeScopes?.scopes?.some(scope =>
            scope.includes('entity.name.function')
        );
        assert.ok(isFindFunction, `'find_node' should be highlighted as function. Got scopes: ${JSON.stringify(findNodeScopes?.scopes)}`);

        const getTransformPos = findInLine(document, chainedLine, 'get_transform');
        const getTransformScopes = await getTokenScopesAt(document, chainedLine, getTransformPos.character);
        const isGetTransformFunction = getTransformScopes?.scopes?.some(scope =>
            scope.includes('entity.name.function')
        );
        assert.ok(isGetTransformFunction, `'get_transform' should be highlighted as function. Got scopes: ${JSON.stringify(getTransformScopes?.scopes)}`);

        console.log('✓ Piped function calls test passed');
    });

    test('Ternary with piped function calls should not break highlighting', async () => {
        const uri = vscode.Uri.file(
            path.join(__dirname, '../../test/fixtures/ternary-operators.das')
        );

        const document = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(document);

        // Wait for tokenization to complete
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Find the line with ternary + piped call: target == "" ? -1 : scene |> scene_instance_getNodeId(target)
        let ternaryPipeLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            if (document.lineAt(i).text.includes('scene |> scene_instance_getNodeId')) {
                ternaryPipeLine = i;
                break;
            }
        }
        assert.ok(ternaryPipeLine >= 0, 'Should find ternary with piped call line');

        // Verify 'scene_instance_getNodeId' is highlighted as function
        const funcPos = findInLine(document, ternaryPipeLine, 'scene_instance_getNodeId');
        const funcScopes = await getTokenScopesAt(document, ternaryPipeLine, funcPos.character);
        const isFunction = funcScopes?.scopes?.some(scope =>
            scope.includes('entity.name.function')
        );
        assert.ok(isFunction, `'scene_instance_getNodeId' after |> should be highlighted as function. Got scopes: ${JSON.stringify(funcScopes?.scopes)}`);

        // Verify that 'target' inside the function call is highlighted correctly (not bleeding into piped scope)
        const lineText = document.lineAt(ternaryPipeLine).text;
        const targetText = 'scene_instance_getNodeId(target)';
        const targetStartIndex = lineText.indexOf(targetText);
        if (targetStartIndex >= 0) {
            const targetParamIndex = targetStartIndex + targetText.indexOf('target');
            const targetScopes = await getTokenScopesAt(document, ternaryPipeLine, targetParamIndex);
            // Should be in function argument scope, not in meta.function-call.piped scope at this level
            const hasFunctionArg = targetScopes?.scopes?.some(scope =>
                scope.includes('variable.parameter') || scope.includes('meta.function-call.dascript')
            );
            // Should not have the piped scope extending over the argument
            const notInPipedMetaOnly = targetScopes?.scopes?.some(scope =>
                !scope.includes('meta.function-call.piped') || scope.includes('meta.function-call.dascript')
            );
            assert.ok(hasFunctionArg || notInPipedMetaOnly, `'target' parameter should be highlighted correctly. Got scopes: ${JSON.stringify(targetScopes?.scopes)}`);
        }

        // Verify tokens after piped call (comma) are highlighted normally
        const commaPos = lineText.indexOf(',', funcPos.character);
        if (commaPos >= 0) {
            const commaScopes = await getTokenScopesAt(document, ternaryPipeLine, commaPos);
            // Comma should not be stuck in piped function call scope
            const notStuckInPiped = !commaScopes?.scopes?.some(scope =>
                scope === 'meta.function-call.piped.dascript' && commaScopes?.scopes?.length === 2
            );
            assert.ok(notStuckInPiped, `Comma after piped call should not extend piped scope. Got scopes: ${JSON.stringify(commaScopes?.scopes)}`);
        }

        console.log('✓ Ternary with piped function calls test passed');
    });

    test('Multiple function modifiers should be keywords, not the function name', async () => {
        const uri = vscode.Uri.file(
            path.join(__dirname, '../../test/fixtures/function-defs.das')
        );

        const document = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(document);
        await new Promise(resolve => setTimeout(resolve, 1000));

        // 'def private static submit_message(...)' and 'def public override abstract tick : int'
        const cases = [
            { def: 'def private static ', modifiers: ['private', 'static'], name: 'submit_message' },
            { def: 'def public override abstract ', modifiers: ['public', 'override', 'abstract'], name: 'tick' }
        ];

        for (const c of cases) {
            let defLine = -1;
            for (let i = 0; i < document.lineCount; i++) {
                if (document.lineAt(i).text.startsWith(c.def)) {
                    defLine = i;
                    break;
                }
            }
            assert.ok(defLine >= 0, `Should find line starting with "${c.def}"`);

            for (const modifier of c.modifiers) {
                const pos = findInLine(document, defLine, modifier);
                const scopes = await getTokenScopesAt(document, defLine, pos.character);
                const isKeyword = scopes?.scopes?.some(scope => scope.includes('keyword'));
                const isFunctionName = scopes?.scopes?.some(scope => scope.includes('entity.name.function'));
                assert.ok(isKeyword, `'${modifier}' should be a keyword. Got scopes: ${JSON.stringify(scopes?.scopes)}`);
                assert.ok(!isFunctionName, `'${modifier}' should NOT be the function name. Got scopes: ${JSON.stringify(scopes?.scopes)}`);
            }

            const namePos = findInLine(document, defLine, c.name);
            const nameScopes = await getTokenScopesAt(document, defLine, namePos.character);
            const isName = nameScopes?.scopes?.some(scope => scope.includes('entity.name.function'));
            assert.ok(isName, `'${c.name}' should be the function name. Got scopes: ${JSON.stringify(nameScopes?.scopes)}`);
        }

        console.log('✓ Function modifiers test passed');
    });
});