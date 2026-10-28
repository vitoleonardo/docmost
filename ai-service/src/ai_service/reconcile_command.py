from ai_service.bridge_client import BridgeUnavailable
from ai_service.reconcile import ReconcileAborted
from ai_service.worker import IndexSession, configure_logging, exit_with, start_up


def main() -> None:
    configure_logging()
    runtime = start_up()
    with IndexSession(runtime) as session:
        try:
            session.reconcile()
        except ReconcileAborted as aborted:
            if isinstance(aborted.__cause__, BridgeUnavailable):
                message = (
                    f"Wiki bridge unreachable at {runtime.settings.ai_wiki_url}: {aborted.cause}"
                )
            else:
                message = f"Reconcile aborted: {aborted.cause}"
            exit_with(message, aborted)


if __name__ == "__main__":
    main()
