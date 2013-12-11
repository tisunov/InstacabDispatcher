# Random Packet Loss 1%, delay and throttle localhost:9000
sudo ipfw pipe 1 config bw 50KBytes/s delay 500ms plr 0.01
sudo ipfw add 1 pipe 1 src-port 9000
sudo ipfw add 2 pipe 1 dst-port 9000