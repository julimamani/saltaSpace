import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError } from 'viem';

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
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message);
  return String(e);
}
