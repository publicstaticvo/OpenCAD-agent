import json
import math
from pathlib import Path
import re

REGISTRY = json.loads((Path(__file__).resolve().parents[1] / 'shared/cad-schema.json').read_text())

def _check(schema, value):
    if '$ref' in schema:
        name = schema['$ref']
        return _check(REGISTRY['definitions'].get(name, REGISTRY.get(name)), value)
    if 'const' in schema and value != schema['const']:
        return False
    if 'enum' in schema and value not in schema['enum']:
        return False
    if 'oneOf' in schema and sum(_check(s, value) for s in schema['oneOf']) != 1:
        return False
    kind = schema.get('type')
    if kind == 'object':
        if type(value) is not dict or any(k not in value for k in schema.get('required', [])):
            return False
        for key, item in value.items():
            sub = schema.get('properties', {}).get(key)
            if sub is None and schema.get('additionalProperties') is False:
                return False
            if sub is not None and not _check(sub, item):
                return False
    if kind == 'array':
        if type(value) is not list or not schema.get('minItems', 0) <= len(value) <= schema.get('maxItems', math.inf):
            return False
        if 'items' in schema and not all(_check(schema['items'], v) for v in value):
            return False
    if kind in ('number', 'integer'):
        if type(value) not in (int, float) or not math.isfinite(value):
            return False
        if kind == 'integer' and (int(value) != value or abs(value) > 9007199254740991):
            return False
        if value < schema.get('minimum', -math.inf) or value > schema.get('maximum', math.inf):
            return False
        if 'exclusiveMinimum' in schema and value <= schema['exclusiveMinimum']:
            return False
    if kind == 'string':
        if type(value) is not str or len(value.encode('utf-16-le')) // 2 > schema.get('maxLength', math.inf):
            return False
        if 'pattern' in schema and re.search(schema['pattern'], value) is None:
            return False
    return True

def _json(value):
    if value is None or type(value) in (str, bool):
        return True
    if type(value) in (float, int):
        return math.isfinite(value)
    if type(value) is list:
        return all(_json(v) for v in value)
    return type(value) is dict and all(type(k) is str and _json(v) for k, v in value.items())

def assert_contract(kind, value):
    if kind not in REGISTRY or not _json(value) or not _check(REGISTRY[kind], value):
        raise ValueError(f'Invalid {kind}: strict CAD schema')
