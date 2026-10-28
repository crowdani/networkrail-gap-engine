#!/bin/bash
# =============================================================================
# Network Rail Gap Engine — Build & Push Images to OpenShift
# =============================================================================
# Builds all container images for linux/amd64 and pushes them to the
# OpenShift internal image registry. Optionally restarts deployments.
#
# Prerequisites:
#   - oc CLI logged in:  oc login <api-url> -u <user> -p <password>
#   - podman installed
#   - OpenShift namespace exists: networkrail-gap-engine
#
# Usage:
#   ./build-and-deploy-images.sh              # build + push + restart pods
#   ./build-and-deploy-images.sh --no-deploy  # build + push only
# =============================================================================

set -e

# ---- colour helpers --------------------------------------------------------
GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'
RED='\033[0;31m';   NC='\033[0m'
info()    { echo -e "${BLUE}$*${NC}"; }
success() { echo -e "${GREEN}✓ $*${NC}"; }
warn()    { echo -e "${YELLOW}$*${NC}"; }
error()   { echo -e "${RED}ERROR: $*${NC}"; exit 1; }

DEPLOY=true
[ "${1:-}" = "--no-deploy" ] && DEPLOY=false

echo ""
info "================================================"
info " Network Rail Gap Engine — Build & Push"
info "================================================"
echo ""

# ---- check oc login --------------------------------------------------------
oc whoami >/dev/null 2>&1 || error "Not logged in to OpenShift. Run: oc login <api-url>"
NS="networkrail-gap-engine"
oc get namespace "$NS" >/dev/null 2>&1 || error "Namespace $NS not found. Run: oc new-project $NS"

# ---- registry login --------------------------------------------------------
REGISTRY=$(oc registry info 2>/dev/null) \
    || error "Could not get registry info. Ensure the image registry route is exposed:
  oc patch configs.imageregistry.operator.openshift.io/cluster \\
    --patch='{\"spec\":{\"defaultRoute\":true}}' --type=merge"

info "Registry: $REGISTRY"
info "Logging in to registry..."
USER_FOR_LOGIN="$(oc whoami)"
[ "$USER_FOR_LOGIN" = "kube:admin" ] && USER_FOR_LOGIN="kubeadmin"
podman login \
    --username "$USER_FOR_LOGIN" \
    --password "$(oc whoami -t)" \
    "$REGISTRY" \
    --tls-verify=false
success "Registry login"

# ---- image names -----------------------------------------------------------
REG="$REGISTRY/$NS"
IMAGE_GAP_DETECTOR="$REG/completed-journey-gap-detector:latest"
IMAGE_INFILL_PREDICTOR="$REG/infill-predictor:latest"
IMAGE_STOMP="$REG/stomp-client:latest"
IMAGE_FRONTEND="$REG/frontend:latest"

# ---- build -----------------------------------------------------------------
info "Building images for linux/amd64 (OpenShift nodes are amd64)..."
echo "  Note: building on Apple Silicon uses QEMU emulation — expect ~5-10 min per image."
echo ""

info "[1/4] Building completed-gap-detector..."
podman build \
    --platform linux/amd64 \
    -t "$IMAGE_GAP_DETECTOR" \
    -f gap_detector/Dockerfile.completed-gap-detector \
    gap_detector/
success "completed-gap-detector built"

info "[2/4] Building infill-predictor..."
podman build \
    --platform linux/amd64 \
    -t "$IMAGE_INFILL_PREDICTOR" \
    -f gap_detector/Dockerfile.infill-predictor \
    gap_detector/
success "infill-predictor built"

info "[3/4] Building stomp-client..."
podman build \
    --platform linux/amd64 \
    -t "$IMAGE_STOMP" \
    -f stomp_client/Dockerfile \
    stomp_client/
success "stomp-client built"

info "[4/4] Building frontend..."
podman build \
    --platform linux/amd64 \
    -t "$IMAGE_FRONTEND" \
    -f Dockerfile \
    .
success "frontend built"

# ---- push ------------------------------------------------------------------
info "Pushing images..."

podman push "$IMAGE_GAP_DETECTOR"      --tls-verify=false && success "completed-gap-detector pushed"
podman push "$IMAGE_INFILL_PREDICTOR"  --tls-verify=false && success "infill-predictor pushed"
podman push "$IMAGE_STOMP"             --tls-verify=false && success "stomp-client pushed"
podman push "$IMAGE_FRONTEND"          --tls-verify=false && success "frontend pushed"

# ---- restart deployments ---------------------------------------------------
if [ "$DEPLOY" = "true" ]; then
    echo ""
    info "Restarting deployments to pick up new images..."
    for dep in completed-gap-detector infill-predictor stomp-client frontend; do
        oc rollout restart deployment/"$dep" -n "$NS" 2>/dev/null \
            && success "  Restarted $dep" \
            || warn "  $dep deployment not found — skipping (apply k8s/ manifests first)"
    done

    echo ""
    info "Waiting for rollouts..."
    for dep in completed-gap-detector infill-predictor stomp-client frontend; do
        oc rollout status deployment/"$dep" -n "$NS" --timeout=300s 2>/dev/null || true
    done
fi

# ---- summary ---------------------------------------------------------------
echo ""
success "================================================"
success " Build & push complete"
success "================================================"
echo ""
echo "  Images:"
echo "    $IMAGE_GAP_DETECTOR"
echo "    $IMAGE_INFILL_PREDICTOR"
echo "    $IMAGE_STOMP"
echo "    $IMAGE_FRONTEND"
echo ""
echo "  Useful commands:"
echo "    oc get pods -n $NS"
echo "    oc logs -f deployment/completed-gap-detector -n $NS"
echo "    oc logs -f deployment/infill-predictor -n $NS"
echo "    oc logs -f deployment/frontend -n $NS"
echo ""
