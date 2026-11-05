import socket
import sys

with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as server:
    server.bind(sys.argv[1])
    print('bound', flush=True)
    sys.stdin.readline()
    server.listen(1)
    connection, _ = server.accept()
    with connection:
        connection.sendall(b'listening\n')
