"""Private, bounded JSON-RPC transport. Native CAD calls stay on this main thread."""
import argparse
import json
import os
from pathlib import Path
import socket
import sys
import uuid

MAX_FRAME = 1048576

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--runtime', required=True)
    parser.add_argument('--socket', required=True)
    parser.add_argument('--workspace', required=True)
    parser.add_argument('--parent-pid', type=int)
    args = parser.parse_args()
    if args.parent_pid:
        import threading,time,signal
        def watch_parent():
            while True:
                if os.getppid()!=args.parent_pid:
                    Path(args.socket).unlink(missing_ok=True)
                    os.killpg(os.getpgrp(),signal.SIGKILL)
                time.sleep(0.25)
        threading.Thread(target=watch_parent,daemon=True).start()
    sys.path.insert(0, str(Path(args.runtime) / 'usr/lib'))
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    import FreeCAD as App
    import Part
    import Sketcher
    from worker.contracts import assert_contract
    runtime = dict(freecad='.'.join(App.Version()[:3]), python=sys.version.split()[0], occt=Part.OCC_VERSION, gui=App.GuiUp)
    if runtime != dict(freecad='1.1.3', python='3.11.14', occt='7.8.1', gui=0):
        raise RuntimeError(f'Runtime drift: {runtime}')
    from worker.candidates import Candidates
    candidates = Candidates(args.workspace)
    instance = uuid.uuid4().hex
    def dispatch(method, params):
        if method == 'hello':
            if params: raise ValueError('hello takes no arguments')
            return dict(protocolVersion=1, workerInstanceId=instance, runtime=runtime, capabilities=['inspect_document','begin_candidate','apply_operations','prepare_candidate','discard_candidate'])
        return candidates.dispatch(method, params)
    def error(code, message, request_id=None):
        return dict(jsonrpc='2.0', id=request_id, error=dict(code=code, message=message))
    def handle(line):
        request = None
        try:
            request = json.loads(line.decode('utf8'), parse_constant=lambda _: (_ for _ in ()).throw(ValueError('Non-finite JSON')))
        except (ValueError, UnicodeError):
            return error(-32700, 'Invalid JSON')
        request_id = request.get('id') if isinstance(request, dict) else None
        try:
            assert_contract('rpc', request)
        except (ValueError, TypeError, OverflowError):
            return error(-32600, 'Invalid request', request_id)
        try:
            return dict(jsonrpc='2.0', id=request_id, result=dispatch(request['method'], request['params']))
        except LookupError:
            return error(-32601, 'Method not found', request_id)
        except Exception as exc:
            return error(-32602, str(exc)[:2000], request_id)
    os.umask(0o077)
    path = Path(args.socket)
    if path.exists(): raise RuntimeError('Socket already exists')
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as server:
        server.bind(str(path))
        os.chmod(path, 0o600)
        server.listen(1)
        try:
            while True:
                conn, _ = server.accept()
                with conn:
                    conn.settimeout(30)
                    data = b''
                    try:
                        while True:
                            chunk = conn.recv(65536)
                            if not chunk: break
                            data += chunk
                            while b'\n' in data:
                                line, data = data.split(b'\n', 1)
                                if len(line) > MAX_FRAME:
                                    conn.sendall((json.dumps(error(-32001, 'Frame too large'))+'\n').encode()); break
                                conn.sendall((json.dumps(handle(line), allow_nan=False)+'\n').encode())
                            else:
                                if len(data) <= MAX_FRAME: continue
                                conn.sendall((json.dumps(error(-32001, 'Frame too large'))+'\n').encode())
                            break
                    except (OSError, TimeoutError):
                        pass
        finally:
            path.unlink(missing_ok=True)

if __name__ == '__main__':
    main()
