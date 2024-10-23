import { Schema, Definition, Field, DefinitionKind } from "./schema";
import { error, quote } from "./util";

export const nativeTypes = [
  'bool',
  'byte',
  'float',
  'int',
  'int64',
  'string',
  'uint',
  'uint64',
];

// These are special names on the object returned by compileSchema()
export const reservedNames = [
  'ByteBuffer',
  'package',
];

const regex = /((?:-|\b)\d+\b|[=;{}]|\[\]|\[deprecated\]|\b[A-Za-z_][A-Za-z0-9_]*\b|\/\/.*|\s+)/g;
const identifier = /^[A-Za-z_][A-Za-z0-9_]*$/;
const whitespace = /^\/\/.*|\s+$/;
const equals = /^=$/;
const endOfFile = /^$/;
const semicolon = /^;$/;
const integer = /^-?\d+$/;
const leftBrace = /^\{$/;
const rightBrace = /^\}$/;
const arrayToken = /^\[\]$/;
const enumKeyword = /^enum$/;
const structKeyword = /^struct$/;
const messageKeyword = /^message$/;
const packageKeyword = /^package$/;
const deprecatedToken = /^\[deprecated\]$/;

interface Token {
  text: string
  line: number
  column: number
}

function tokenize(text: string): Token[] {
  const parts = text.split(regex);
  const tokens = [];
  let column = 0;
  let line = 0;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];

    // Keep non-whitespace tokens
    if (i & 1) {
      if (!whitespace.test(part)) {
        tokens.push({
          text: part,
          line: line + 1,
          column: column + 1,
        });
      }
    }

    // Detect syntax errors
    else if (part !== '') {
      error('Syntax error ' + quote(part), line + 1, column + 1);
    }

    // Keep track of the line and column counts
    const lines = part.split('\n');
    if (lines.length > 1) column = 0;
    line += lines.length - 1;
    column += lines[lines.length - 1].length;
  }

  // End-of-file token
  tokens.push({
    text: '',
    line: line,
    column: column,
  });

  return tokens;
}

function parse(tokens: Token[]): Schema {
  function current(): Token {
    return tokens[index];
  }

  function eat(test: RegExp): boolean {
    if (test.test(current().text)) {
      index++;
      return true;
    }
    return false;
  }

  function expect(test: RegExp, expected: string): void {
    if (!eat(test)) {
      const token = current();
      error('Expected ' + expected + ' but found ' + quote(token.text), token.line, token.column);
    }
  }

  function unexpectedToken(): never {
    const token = current();
    error('Unexpected token ' + quote(token.text), token.line, token.column);
  }

  const definitions: Definition[] = [];
  let packageText = null;
  let index = 0;

  if (eat(packageKeyword)) {
    packageText = current().text;
    expect(identifier, 'identifier');
    expect(semicolon, '";"');
  }

  while (index < tokens.length && !eat(endOfFile)) {
    const fields: Field[] = [];
    let kind: DefinitionKind;

    if (eat(enumKeyword)) kind = 'ENUM';
    else if (eat(structKeyword)) kind = 'STRUCT';
    else if (eat(messageKeyword)) kind = 'MESSAGE';
    else unexpectedToken();

    // All definitions start off the same
    const name = current();
    expect(identifier, 'identifier');
    expect(leftBrace, '"{"');

    // Parse fields
    while (!eat(rightBrace)) {
      let type: string | null = null;
      let isArray = false;
      let isDeprecated = false;

      // Enums don't have types
      if (kind !== 'ENUM') {
        type = current().text;
        expect(identifier, 'identifier');
        isArray = eat(arrayToken);
      }

      const field = current();
      expect(identifier, 'identifier');

      // Structs don't have explicit values
      let value: Token | null = null;
      if (kind !== 'STRUCT') {
        expect(equals, '"="');
        value = current();
        expect(integer, 'integer');

        if ((+value.text | 0) + '' !== value.text) {
          error('Invalid integer ' + quote(value.text), value.line, value.column);
        }
      }

      const deprecated = current();
      if (eat(deprecatedToken)) {
        if (kind !== 'MESSAGE') {
          error('Cannot deprecate this field', deprecated.line, deprecated.column);
        }

        isDeprecated = true;
      }

      expect(semicolon, '";"');

      fields.push({
        name: field.text,
        line: field.line,
        column: field.column,
        type: type,
        isArray: isArray,
        isDeprecated: isDeprecated,
        value: value !== null ? +value.text | 0 : fields.length + 1,
      });
    }

    definitions.push({
      name: name.text,
      line: name.line,
      column: name.column,
      kind: kind,
      fields: fields,
    });
  }

  return {
    package: packageText,
    definitions: definitions,
  };
}

function verify(root: Schema): void {
  const definedTypes = nativeTypes.slice();
  const definitions: { [name: string]: Definition } = {};

  // Define definitions
  for (let i = 0; i < root.definitions.length; i++) {
    const definition = root.definitions[i];
    if (definedTypes.indexOf(definition.name) !== -1) {
      error('The type ' + quote(definition.name) + ' is defined twice', definition.line, definition.column);
    }
    if (reservedNames.indexOf(definition.name) !== -1) {
      error('The type name ' + quote(definition.name) + ' is reserved', definition.line, definition.column);
    }
    definedTypes.push(definition.name);
    definitions[definition.name] = definition;
  }

  // Check fields
  for (let i = 0; i < root.definitions.length; i++) {
    const definition = root.definitions[i];
    const fields = definition.fields;

    if (definition.kind === 'ENUM' || fields.length === 0) {
      continue;
    }

    // Check types
    for (let j = 0; j < fields.length; j++) {
      const field = fields[j];
      if (definedTypes.indexOf(field.type!) === -1) {
        error('The type ' + quote(field.type!) + ' is not defined for field ' + quote(field.name), field.line, field.column);
      }
    }

    // Check values
    const values: number[] = [];
    for (let j = 0; j < fields.length; j++) {
      const field = fields[j];
      if (values.indexOf(field.value) !== -1) {
        error('The id for field ' + quote(field.name) + ' is used twice', field.line, field.column);
      }
      if (field.value <= 0) {
        error('The id for field ' + quote(field.name) + ' must be positive', field.line, field.column);
      }
      if (field.value > fields.length) {
        error('The id for field ' + quote(field.name) + ' cannot be larger than ' + fields.length, field.line, field.column);
      }
      values.push(field.value);
    }
  }

  // Check that structs don't contain themselves
  const state: { [name: string]: number } = {};
  const check = (name: string): boolean => {
    const definition = definitions[name];
    if (definition && definition.kind === 'STRUCT') {
      if (state[name] === 1) {
        error('Recursive nesting of ' + quote(name) + ' is not allowed', definition.line, definition.column);
      }
      if (state[name] !== 2 && definition) {
        state[name] = 1;
        const fields = definition.fields;
        for (let i = 0; i < fields.length; i++) {
          const field = fields[i];
          if (!field.isArray) {
            check(field.type!);
          }
        }
        state[name] = 2;
      }
    }
    return true;
  };
  for (let i = 0; i < root.definitions.length; i++) {
    check(root.definitions[i].name);
  }
}

export function parseSchema(text: string): Schema {
  const schema = parse(tokenize(text));
  verify(schema);
  return schema;
}
