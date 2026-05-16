#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${1:-https://github.com/Huutantv/AI.git}"
BRANCH="${2:-main}"
PROJECT_DIR="${PROJECT_DIR:-$HOME/doro-proxy}"

echo "=============================================="
echo "Doro Proxy deploy from GitHub to VPS"
echo "Repo   : $REPO_URL"
echo "Branch : $BRANCH"
echo "Dir    : $PROJECT_DIR"
echo "=============================================="

require_sudo() {
    if ! command -v sudo >/dev/null 2>&1; then
        echo "[!] sudo is required on this VPS."
        exit 1
    fi
}

install_git() {
    if ! command -v git >/dev/null 2>&1; then
        echo "[+] Installing git..."
        sudo apt-get update
        sudo apt-get install -y git
    fi
}

install_docker() {
    if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
        return
    fi

    echo "[+] Installing Docker and Docker Compose plugin..."
    curl -fsSL https://get.docker.com | sudo sh
    sudo usermod -aG docker "$USER" || true
}

docker_compose() {
    sudo docker compose "$@"
}

get_port() {
    local port
    port="$(grep -E '^DORO_PROXY_PORT=' .env 2>/dev/null | tail -n 1 | cut -d'=' -f2- | tr -d '\r')"
    if [ -z "$port" ]; then
        port="4000"
    fi
    printf '%s' "$port"
}

open_port() {
    local port
    port="$(get_port)"
    if command -v ufw >/dev/null 2>&1 && sudo ufw status | grep -q "Status: active"; then
        echo "[+] Opening port $port in UFW..."
        sudo ufw allow "$port"/tcp || true
    fi
}

sync_repo() {
    if [ -d "$PROJECT_DIR/.git" ]; then
        echo "[+] Updating existing repo..."
        git -C "$PROJECT_DIR" fetch origin "$BRANCH"
        git -C "$PROJECT_DIR" checkout "$BRANCH"
        git -C "$PROJECT_DIR" pull --ff-only origin "$BRANCH"
    else
        echo "[+] Cloning repo..."
        git clone --branch "$BRANCH" "$REPO_URL" "$PROJECT_DIR"
    fi
}

prepare_env() {
    cd "$PROJECT_DIR"
    if [ ! -f .env ]; then
        if [ -f .env.example ]; then
            cp .env.example .env
            echo "[!] .env created from .env.example"
            echo "[!] Edit it now: nano $PROJECT_DIR/.env"
            exit 1
        fi
        echo "[!] Missing .env and .env.example"
        exit 1
    fi
}

start_stack() {
    cd "$PROJECT_DIR"
    echo "[+] Building and starting containers..."
    docker_compose pull || true
    docker_compose up -d --build
}

show_result() {
    cd "$PROJECT_DIR"
    local port
    port="$(get_port)"
    echo ""
    echo "=============================================="
    echo "Deploy complete"
    echo "Health : curl http://$(hostname -I | awk '{print $1}'):$port/health"
    echo "Logs   : sudo docker compose logs -f"
    echo "Update : cd $PROJECT_DIR && git pull && sudo docker compose up -d --build"
    echo "=============================================="
    docker_compose ps
}

require_sudo
install_git
install_docker
sync_repo
prepare_env
open_port
start_stack
show_result
