from ai_service.bridge_client import BridgeRefused, BridgeUnreachable
from ai_service.reconcile import ReconcileAborted
from ai_service.worker import IndexSession, configure_logging, exit_with, start_up


def abort_message(aborted: ReconcileAborted, wiki_url: str) -> str:
    if isinstance(aborted.__cause__, BridgeUnreachable):
        return f"Wiki bridge unreachable at {wiki_url}: {aborted.cause}"
    if isinstance(aborted.__cause__, BridgeRefused):
        return f"Wiki bridge refused the reconcile at {wiki_url}: {aborted.cause}"
    return f"Reconcile aborted: {aborted.cause}"


def main() -> None:
    configure_logging()
    runtime = start_up()
    with IndexSession(runtime) as session:
        try:
            session.reconcile()
        except ReconcileAborted as aborted:
            exit_with(abort_message(aborted, runtime.settings.ai_wiki_url), aborted)


if __name__ == "__main__":
    main()
