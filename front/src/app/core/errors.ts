import {
  BaseError,
  ContractFunctionRevertedError,
  HttpRequestError,
  LimitExceededRpcError,
  UserRejectedRequestError,
} from 'viem';

export const RATE_LIMIT_MESSAGE =
  'La red está saturada (límite de peticiones del RPC). Esperá unos segundos y reintentá.';
const RATE_LIMIT_RE = /rate limit|too many requests|status: 429/i;

/** RPC rate limit (HTTP 429), whether it came through viem or from the wallet (MetaMask: -32603 "Request is being rate limited."). */
export function isRateLimited(e: unknown): boolean {
  const matches = (x: unknown) =>
    x instanceof LimitExceededRpcError ||
    (x instanceof HttpRequestError && x.status === 429) ||
    (!!x && typeof x === 'object' && 'message' in x && RATE_LIMIT_RE.test(String(x.message)));
  return e instanceof BaseError ? !!e.walk(matches) : matches(e);
}

const FRIENDLY: Record<string, string> = {
  FundingClosed: 'La campaña ya cerró.',
  ExceedsGoal: 'Superás los tokens disponibles del lote.',
  InvalidStatus: 'La acción no es válida en el estado actual del lote.',
  DeadlineNotReached: 'La campaña todavía está abierta.',
  AlreadyReleased: 'Los fondos ya fueron liberados al productor.',
  NotMatured: 'Todavía no llegó la fecha de cosecha (madurez).',
  NoMetrics: 'El oráculo aún no publicó métricas para este lote.',
  NothingToClaim: 'No tenés tokens de este lote.',
  NotVerified: 'La wallet no está verificada (KYC).',
  AccessControlUnauthorizedAccount: 'No tenés permisos para esta acción.',
  FaucetCooldown: 'El faucet se puede usar una vez por hora.',
  InvalidParams: 'Parámetros del lote inválidos.',
  ZeroAmount: 'El monto debe ser mayor a cero.',
  EnforcedPause: 'El protocolo está pausado.',
  ERC20InsufficientBalance: 'Saldo de USDC insuficiente.',
  ERC20InsufficientAllowance: 'Falta aprobar USDC.',
};

export function errorMessage(e: unknown): string {
  if (e instanceof BaseError) {
    if (e.walk((x) => x instanceof UserRejectedRequestError)) return 'Rechazaste la transacción en la wallet.';
    if (isRateLimited(e)) return RATE_LIMIT_MESSAGE;
    const revert = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      const name = revert.data?.errorName;
      if (name) {
        const extra = name === 'InvalidParams' && revert.data?.args?.[0] ? ` (${String(revert.data.args[0])})` : '';
        return (FRIENDLY[name] ?? name) + extra;
      }
      return revert.reason ?? revert.shortMessage;
    }
    return e.shortMessage;
  }
  if (isRateLimited(e)) return RATE_LIMIT_MESSAGE;
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message);
  return String(e);
}
