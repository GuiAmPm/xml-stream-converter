'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.default = convert;

var _sax = require('sax');

var _sax2 = _interopRequireDefault(_sax);

var _stream = require('stream');

var _stream2 = _interopRequireDefault(_stream);

var _jsonpointer = require('jsonpointer');

var _jsonpointer2 = _interopRequireDefault(_jsonpointer);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function qnameLocal(tag) {
    const parts = tag.split(':');
    return parts.length >= 2 ? parts[1] : parts[0];
}

function resolveSchemaNode(rootSchema, node) {
    while (node && node['$ref']) {
        if (node['$ref'][0] === '#') {
            node = _jsonpointer2.default.get(rootSchema, node['$ref'].substr(1));
        } else {
            node = _jsonpointer2.default.get(rootSchema, node['$ref']);
        }
    }
    return node;
}

function normalizeArrayItems(items) {
    if (Array.isArray(items)) {
        return items;
    } else {
        if (typeof items === 'object') {
            return [items];
        } else {
            return [];
        }
    }
}

function convert(xmlStream, schema, { strict = false, trimText = true } = {}) {
    const saxStream = _sax2.default.createStream(true, { xmlns: false });
    const jsonStream = new _stream2.default.Readable();

    const rootSchema = schema;
    const contextStack = [{
        root: true,
        schema: rootSchema,
        firstItem: true,
        hasText: false
    }];

    saxStream.on('opentag', node => {
        const context = contextStack[contextStack.length - 1];
        let result = '';
        switch (context.schema.type) {
            case 'string':
            case 'integer':
            case 'number':
            case 'boolean':
                if (strict) {
                    throw new Error('Did not expect element <' + node.name + '> for schema type ' + context.schema.type);
                } else {
                    contextStack.push(context);
                }
                break;
            case 'object':
                {
                    const name = qnameLocal(node.name);
                    const schemaNode = resolveSchemaNode(rootSchema, context.schema.properties[name]) || (strict ? null : { type: 'array' });
                    if (context.root) {
                        result += '{';
                    }
                    if (!schemaNode) {
                        console.error(contextStack);
                        throw new Error('Element <' + node.name + '> cannot be matched against object type in schema.');
                    }
                    if (!context.firstItem) {
                        result += ',';
                    }
                    result += JSON.stringify(name) + ':';
                    if (schemaNode.type === 'object') {
                        result += '{';
                    } else if (schemaNode.type === 'array') {
                        result += '[';
                    }
                    context.firstItem = false;
                    contextStack.push({ root: false, schema: schemaNode, firstItem: true, hasText: false });
                    break;
                }
            case 'array':
                {
                    const name = qnameLocal(node.name);
                    const items = normalizeArrayItems(context.schema.items);
                    const schemaNode = resolveSchemaNode(rootSchema, items.find(item => item.title === name)) || (strict ? null : { type: 'array' });
                    if (context.root) {
                        result += '[';
                    }
                    if (!schemaNode) {
                        console.error(contextStack);
                        throw new Error('Element <' + node.name + '> cannot be matched against array items in schema.');
                    }
                    if (!context.firstItem) {
                        result += ',';
                    }
                    if (items.length >= 2) {
                        result += '{' + JSON.stringify(name) + ':';
                    }
                    if (schemaNode.type === 'object') {
                        result += '{';
                    } else if (schemaNode.type === 'array') {
                        result += '[';
                    }
                    context.firstItem = false;
                    contextStack.push({ root: false, schema: schemaNode, firstItem: true, hastText: false });
                    break;
                }
            default:
                throw new Error('Unknown type in schema: ' + context.schema.type);
        }
        if (result.length >= 1) {
            if (!jsonStream.push(result)) {
                xmlStream.pause();
            }
        }
    });

    saxStream.on('text', text => {
        const context = contextStack[contextStack.length - 1];
        let result;
        switch (context.schema.type) {
            case 'string':
                result = JSON.stringify(text);
                break;
            case 'integer':
            case 'number':
            case 'boolean':
                result = text.toLowerCase();
                break;
            case 'object':
            case 'array':
                if (strict) {
                    throw new Error('Did not expect a text element to match ' + context.schema.type + ' (found "' + text + '" while parsing ' + JSON.stringify(context.schema) + ')');
                } else {
                    result = JSON.stringify(text);
                }
                break;
            default:
                throw new Error('Unknown type (in schema): ' + context.schema.type);
        }
        if (trimText) {
            result = result.trim();
        }
        if (result.length >= 1) {
            context.hasText = true;
            if (!jsonStream.push(result)) {
                xmlStream.pause();
            }
        }
    });

    saxStream.on('closetag', name => {
        const context = contextStack.pop();
        let result;
        switch (context.schema.type) {
            case 'string':
            case 'integer':
            case 'number':
            case 'boolean':
                if (context.hasText) {
                    result = '';
                } else {
                    result = 'null';
                }
                break;
            case 'object':
                result = '}';
                break;
            case 'array':
                result = ']';
                break;
            default:
                throw new Error('Unknown type in schema: ' + context.schema.type);
        }
        const parent = contextStack[contextStack.length - 1];
        if (parent.schema.type === 'array' && normalizeArrayItems(parent.schema.items).length >= 2) {
            result += '}';
        }
        if (parent.root) {
            if (parent.schema.type === 'object') {
                result += '}';
            } else if (parent.schema.type === 'array') {
                result += ']';
            }
        }
        if (result.length >= 1) {
            if (!jsonStream.push(result)) {
                xmlStream.pause();
            }
        }
    });

    saxStream.on('end', () => {
        jsonStream.push(null);
    });

    xmlStream.on('error', error => {
        jsonStream.emit('error', error);
    });

    saxStream.on('error', error => {
        jsonStream.emit('error', error);
    });

    jsonStream._read = () => {
        xmlStream.resume();
    };

    xmlStream.pipe(saxStream);

    return jsonStream;
}