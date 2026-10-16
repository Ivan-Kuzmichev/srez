"""Builds the blockchain fixtures. Shapes follow Esplora, JSON-RPC and Blockscout's Etherscan-compatible
answers; addresses are the BIP-173 and EIP-55 examples, amounts are made up.

Run from the repository root: python3 tests/fixtures/chains/generate.py
"""
import hashlib
import json
from datetime import datetime, timezone

OUT = 'tests/fixtures/chains/'
BTC = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq'
EVM = '0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed'
OTHER = '0x' + '22' * 20


def dump(name, data):
    with open(OUT + name, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write('\n')


def ts(s):
    return int(datetime.fromisoformat(s).replace(tzinfo=timezone.utc).timestamp())


def uint(v, decimals):
    """A JSON-RPC uint256 of v (a decimal string) in base units."""
    whole, _, frac = v.partition('.')
    n = int(whole + (frac + '0' * decimals)[:decimals])
    return '0x' + format(n, '064x')


# Bitcoin: two receipts and one spend with change; balance 0,05998 BTC.
def btx(txid, height, when, vin, vout, fee):
    return {'txid': txid, 'status': {'confirmed': True, 'block_height': height, 'block_time': ts(when)},
            'fee': fee, 'vin': [{'prevout': {'scriptpubkey_address': a, 'value': v}} for a, v in vin],
            'vout': [{'scriptpubkey_address': a, 'value': v} for a, v in vout]}


other_btc = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'
txs = [  # newest first, as Esplora pages them
    btx('c3' * 32, 830000, '2024-02-20T10:00:00', [(BTC, 2_000_000)], [(other_btc, 1_000_000), (BTC, 998_000)], 2_000),
    btx('b2' * 32, 820000, '2023-12-10T10:00:00', [(other_btc, 2_100_000)], [(BTC, 2_000_000), (other_btc, 98_000)], 2_000),
    btx('a1' * 32, 800000, '2023-07-24T10:00:00', [(other_btc, 5_100_000)], [(BTC, 5_000_000), (other_btc, 98_000)], 2_000),
]
dump('bitcoin.json', {BTC: {
    'chain_stats': {'funded_txo_count': 3, 'funded_txo_sum': 7_998_000, 'spent_txo_count': 1, 'spent_txo_sum': 2_000_000, 'tx_count': 3},
    'txs': txs,
}})

# EVM balances now. stETH grew from 2,0 to 2,0123 by rebasing since it arrived.
STETH = '0xae7ab96520de3a18e5e111b5eaab095312d7fe84'
WSTETH = '0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0'
USDT_ARB = '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9'
SPAM = '0x' + '99' * 20
# Tangem's yield mode: the owner's coins sit in a module the factory deployed; Aave's aUSDT is the module's.
TANGEM_OWNER = '0x' + '33' * 20
TANGEM_MODULE = '0x' + '44' * 20
TANGEM_FACTORY = '0xd8972a45616bec62cb9687e38a99d763c0879b0d'
USDT = '0xdac17f958d2ee523a2206206994597c13d831ec7'
USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
AUSDT = '0x23878914efe38d27c4d67ab83ed1b93a74d4086a'
EFFECTIVE = '0x16a398f7'


def word(address):
    return address[2:].rjust(64, '0')


dump('evm.json', {
    'ethereum': {'blockNumber': 21_000_000,
                 'balances': {EVM: {'native': uint('0.94958', 18), 'tokens': {STETH: uint('2.0123', 18), WSTETH: uint('1.5', 18), SPAM: uint('1000', 18)}},
                              TANGEM_OWNER: {'native': uint('0.1', 18), 'tokens': {}}},
                 'rates': {WSTETH: uint('1.2', 18), '0xae78736cd615f374d3085123a210448e74fc6393': uint('1.1', 18)},
                 # Exact eth_call answers: «to|data». A module call for a coin it never enabled reverts.
                 'calls': {f'{TANGEM_FACTORY}|0x36571e2c{word(TANGEM_OWNER)}': '0x' + word(TANGEM_MODULE),
                           f'{TANGEM_MODULE}|{EFFECTIVE}{word(USDT)}': uint('480.12', 6),
                           f'{TANGEM_MODULE}|{EFFECTIVE}{word(USDC)}': uint('0', 6)},
                 'reverts': [TANGEM_MODULE]},
    'arbitrum': {'blockNumber': 280_000_000, 'balances': {EVM: {'native': uint('0', 18), 'tokens': {USDT_ARB: uint('1250', 6)}}}, 'rates': {}},
    'base': {'blockNumber': 22_000_000, 'balances': {}, 'rates': {}},
    'polygon': {'blockNumber': 63_000_000, 'balances': {}, 'rates': {}},
    'bnb': {'blockNumber': 44_000_000, 'balances': {}, 'rates': {}},
})


def ntx(h, block, when, frm, to, eth, gas_used=21000, gas_price=20_000_000_000, error='0'):
    wei = int(round(float(eth) * 10**6)) * 10**12
    return {'hash': h, 'blockNumber': str(block), 'timeStamp': str(ts(when)), 'from': frm, 'to': to, 'value': str(wei),
            'gasUsed': str(gas_used), 'gasPrice': str(gas_price), 'isError': error}


def ttx(h, block, when, frm, to, contract, symbol, name, decimals, amount, log):
    whole, _, frac = amount.partition('.')
    value = int(whole + (frac + '0' * decimals)[:decimals])
    return {'hash': h, 'blockNumber': str(block), 'timeStamp': str(ts(when)), 'from': frm, 'to': to, 'value': str(value),
            'contractAddress': contract, 'tokenSymbol': symbol, 'tokenName': name, 'tokenDecimal': str(decimals), 'logIndex': str(log)}


ZERO = '0x' + '00' * 20
dump('blockscout.json', {
    '1': {TANGEM_OWNER: {
        'txlist': [],
        'txlistinternal': [],
        'tokentx': [
            # Straight to Aave first: aUSDT minted to the wallet, then withdrawn (burned) for USDT…
            ttx('0x' + 'a0' * 32, 19_000_000, '2024-01-10T09:00:00', OTHER, TANGEM_OWNER, USDT, 'USDT', 'Tether USD', 6, '500', 1),
            ttx('0x' + 'a1' * 32, 19_000_100, '2024-01-10T10:00:00', TANGEM_OWNER, AUSDT, USDT, 'USDT', 'Tether USD', 6, '500', 1),
            ttx('0x' + 'a1' * 32, 19_000_100, '2024-01-10T10:00:00', ZERO, TANGEM_OWNER, AUSDT, 'aEthUSDT', 'Aave Ethereum USDT', 6, '500', 2),
            ttx('0x' + 'a2' * 32, 20_100_000, '2025-11-30T09:00:00', TANGEM_OWNER, ZERO, AUSDT, 'aEthUSDT', 'Aave Ethereum USDT', 6, '500', 1),
            ttx('0x' + 'a2' * 32, 20_100_000, '2025-11-30T09:00:00', AUSDT, TANGEM_OWNER, USDT, 'USDT', 'Tether USD', 6, '505', 2),
            # …and into Tangem's module, then a monthly top-up, then 200 out of the module and on.
            ttx('0x' + 'a3' * 32, 20_100_010, '2025-11-30T09:10:00', TANGEM_OWNER, TANGEM_MODULE, USDT, 'USDT', 'Tether USD', 6, '505', 1),
            ttx('0x' + 'a4' * 32, 20_200_000, '2026-03-01T09:00:00', OTHER, TANGEM_OWNER, USDT, 'USDT', 'Tether USD', 6, '170', 1),
            ttx('0x' + 'a5' * 32, 20_200_010, '2026-03-01T09:10:00', TANGEM_OWNER, TANGEM_MODULE, USDT, 'USDT', 'Tether USD', 6, '170', 1),
            ttx('0x' + 'a6' * 32, 20_300_000, '2026-06-26T09:00:00', AUSDT, TANGEM_OWNER, USDT, 'USDT', 'Tether USD', 6, '200', 1),
            ttx('0x' + 'a6' * 32, 20_300_000, '2026-06-26T09:00:00', TANGEM_OWNER, OTHER, USDT, 'USDT', 'Tether USD', 6, '200', 2),
        ],
    }, EVM: {
        'txlist': [
            ntx('0x' + '01' * 32, 19_400_000, '2024-03-14T09:00:00', OTHER, EVM, '1.0'),
            ntx('0x' + '02' * 32, 19_700_000, '2024-04-20T09:00:00', EVM, OTHER, '0.05'),
        ],
        'txlistinternal': [],
        'tokentx': [
            ttx('0x' + '03' * 32, 19_800_000, '2024-05-01T09:00:00', OTHER, EVM, STETH, 'stETH', 'Liquid staked Ether 2.0', 18, '2.0', 12),
            ttx('0x' + '04' * 32, 19_900_000, '2024-05-15T09:00:00', OTHER, EVM, WSTETH, 'wstETH', 'Wrapped liquid staked Ether 2.0', 18, '1.5', 3),
            ttx('0x' + '05' * 32, 20_000_000, '2024-06-01T09:00:00', OTHER, EVM, SPAM, 'Visit claim-rewards.example', 'Claim rewards', 18, '1000', 7),
        ],
    }},
    '42161': {EVM: {
        'txlist': [],
        'txlistinternal': [],
        'tokentx': [ttx('0x' + '06' * 32, 200_000_000, '2024-06-10T09:00:00', OTHER, EVM, USDT_ARB, 'USD₮0', 'USD₮0', 6, '1250', 1)],
    }},
})

B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'


def tron(hex21):
    raw = bytes.fromhex(hex21)
    raw += hashlib.sha256(hashlib.sha256(raw).digest()).digest()[:4]
    n, out = int.from_bytes(raw, 'big'), ''
    while n:
        n, r = divmod(n, 58)
        out = B58[r] + out
    return out


# Tron: 120 TRX in, 20 TRX out (1,1 TRX burned), 300 USDT in, 33,25 USDT out with a 13,4 TRX fee,
# and a fake «USDT» from a look-alike contract.
TRON_HEX = '41' + '55' * 20
TRON_OTHER_HEX = '41' + '66' * 20
TRON = tron(TRON_HEX)
TRON_OTHER = tron(TRON_OTHER_HEX)
TRON_USDT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'
FAKE = tron('41' + '77' * 20)


def ms(s):
    return ts(s) * 1000


def trx(h, when, frm, to, sun, fee, kind='TransferContract'):
    value = {'owner_address': frm, 'to_address': to} | ({'amount': sun} if kind == 'TransferContract' else {})
    return {'txID': h, 'blockNumber': 60_000_000, 'block_timestamp': ms(when), 'ret': [{'contractRet': 'SUCCESS', 'fee': fee}],
            'raw_data': {'contract': [{'type': kind, 'parameter': {'value': value}}]}}


def trc20(h, when, frm, to, contract, symbol, value):
    return {'transaction_id': h, 'token_info': {'symbol': symbol, 'address': contract, 'decimals': 6, 'name': 'Tether USD'},
            'block_timestamp': ms(when), 'from': frm, 'to': to, 'type': 'Transfer', 'value': value}


dump('tron.json', {TRON: {
    'account': {'balance': 85_500_000, 'trc20': [{TRON_USDT: '266750000'}, {FAKE: '1000000000'}]},
    'transactions': [
        trx('b1' * 32, '2025-03-01T09:00:00', TRON_OTHER_HEX, TRON_HEX, 120_000_000, 0),
        trx('b2' * 32, '2025-04-01T09:00:00', TRON_HEX, TRON_OTHER_HEX, 20_000_000, 1_100_000),
        trx('b4' * 32, '2025-06-01T09:00:00', TRON_HEX, '41' + 'a6' * 20, 0, 13_400_000, 'TriggerSmartContract'),
    ],
    'trc20': [
        trc20('b3' * 32, '2025-05-01T09:00:00', TRON_OTHER, TRON, TRON_USDT, 'USDT', '300000000'),
        trc20('b4' * 32, '2025-06-01T09:00:00', TRON, TRON_OTHER, TRON_USDT, 'USDT', '33250000'),
        trc20('b5' * 32, '2025-06-02T09:00:00', FAKE, TRON, FAKE, 'USDT', '1000000000'),
    ],
}})
print('tron address', TRON)
print('chains fixtures written')
