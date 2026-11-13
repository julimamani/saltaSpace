import { HttpRequestError, InternalRpcError, TransactionExecutionError, UserRejectedRequestError } from 'viem';
import { RATE_LIMIT_MESSAGE, errorMessage, isRateLimited } from './errors';

describe('errorMessage', () => {
  it('maps a MetaMask rate-limit error to a friendly message', () => {
    const metamask = { code: -32603, message: 'Request is being rate limited.' };
    expect(errorMessage(metamask)).toBe(RATE_LIMIT_MESSAGE);
    const wrapped = new TransactionExecutionError(new InternalRpcError(metamask as unknown as Error), {} as never);
    expect(errorMessage(wrapped)).toBe(RATE_LIMIT_MESSAGE);
  });

  it('maps an HTTP 429 from the RPC to the friendly message', () => {
    const err = new HttpRequestError({ url: 'http://localhost:8000/rpc', status: 429, details: 'Too Many Requests' });
    expect(isRateLimited(err)).toBe(true);
    expect(errorMessage(err)).toBe(RATE_LIMIT_MESSAGE);
  });

  it('keeps other errors unchanged', () => {
    expect(isRateLimited(new Error('execution reverted'))).toBe(false);
    expect(errorMessage(new UserRejectedRequestError(new Error('denied')))).toBe('Rechazaste la transacción en la wallet.');
  });
});
