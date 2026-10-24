import json
import pathlib
import socket
import tempfile

with tempfile.TemporaryDirectory(prefix="cad-web-uds-") as directory:
    path = str(pathlib.Path(directory) / "worker.sock")
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as server:
        server.settimeout(3)
        server.bind(path)
        server.listen(1)
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
            client.settimeout(3)
            client.connect(path)
            connection, _ = server.accept()
            with connection:
                connection.settimeout(3)
                client.sendall(b'{"jsonrpc":"2.0","id":1}\n')
                assert connection.recv(1024) == b'{"jsonrpc":"2.0","id":1}\n'
print(json.dumps({"af_unix_bind_connect": True, "scope": "local socket only, not production CAD RPC"}))
