#!/bin/bash
# =============================================================================
# Standalone Completed Journey Gap Detector — Build & Deploy to OpenShift
# =============================================================================
# Builds only the standalone Python stream processor image and deploys/restarts
# its dedicated OpenShift deployment, completely independent of other services.
#
# Usage:
#   ./deploy-standalone-gap-detector.sh              # build + push + apply + restart
#   ./deploy-standalone-gap-detector.sh --no-deploy  # build + push only
# =============================================================================

set -e

GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'
RED='\033[0;31m';   NC='\033[0m'
info()    { echo -e "${BLUE}$*${NC}"; }
success() { echo -e "${GREEN}✓ $*${NC}"; }
warn()    { echo -e "${YELLOW}$*${NC}"; }
error()   { echo -e "${RED}ERROR: $*${NC}"; exit 1; }

DEPLOY=true
[ "${1:-}" = "--no-deploy" ] && DEPLOY=false

echo ""
info "=========================================================="
info " Standalone Completed Journey Gap Detector — Build & Push"
info "=========================================================="
echo ""

# Check oc login
oc whoami >/dev/null 2>&1 || error "Not logged in to OpenShift. Run: oc login <api-url>"
NS="networkrail-gap-engine"
oc get namespace "$NS" >/dev/null 2>&1 || error "Namespace $NS not found. Run: oc new-project $NS"

# Registry login
REGISTRY=$(oc registry info 2>/dev/null) \
    || error "Could not get registry info. Ensure the image registry route is exposed."

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

IMAGE_NAME="$REGISTRY/$NS/completed-journey-gap-detector:latest"

# Build dedicated image
info "Building standalone completed-journey-gap-detector image (linux/amd64)..."
podman build \
    --platform linux/amd64 \
    -t "$IMAGE_NAME" \
    -f gap_detector/Dockerfile.completed-gap-detector \
    gap_detector/
success "Image built: $IMAGE_NAME"

# Push
info "Pushing image to OpenShift internal registry..."
podman push "$IMAGE_NAME" --tls-verify=false
success "Image pushed"

# Deploy
if [ "$DEPLOY" = "true" ]; then
    echo ""
    info "Applying standalone Kubernetes deployment..."
    oc apply -f k8s/completed-journey-gap-detector.yaml -n "$NS"

    info "Restarting completed-journey-gap-detector deployment..."
    oc rollout restart deployment/completed-journey-gap-detector -n "$NS"
    
    info "Waiting for rollout..."
    oc rollout status deployment/completed-journey-gap-detector -n "$NS" --timeout=120s
    success "completed-journey-gap-detector is running!"
fi

echo ""
success "=========================================================="
success " Deployment Complete"
success "=========================================================="
echo ""
echo "  Check logs:"
echo "    oc logs -f deployment/completed-journey-gap-detector -n $NS"
echo ""
