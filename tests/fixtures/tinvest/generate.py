"""Builds the T-Invest fixtures. Shapes follow real REST responses; ids, uids and amounts are made up.

Run from the repository root: python3 tests/fixtures/tinvest/generate.py
Cash and holdings are derived from the operations, so the broker's portfolio matches the journal.
"""
import json
from decimal import Decimal as D

OUT = 'tests/fixtures/tinvest/'


def mv(x, cur='rub'):
    x = D(str(x))
    units = int(x)
    return {"currency": cur, "units": str(units), "nano": int((x - units) * 1_000_000_000)}


def q(x):
    m = mv(x)
    return {"units": m["units"], "nano": m["nano"]}


def I(uid, figi, ticker, cls, kind, typ):
    return dict(uid=uid, figi=figi, ticker=ticker, classCode=cls, kind=kind, type=typ)


SBER = I("e6123145-9665-43e0-8413-cd61b8aa9b13", "BBG004730N88", "SBER", "TQBR", "INSTRUMENT_TYPE_SHARE", "share")
LKOH = I("02cfdf61-6298-4c0f-a9ca-9cabc82afaf3", "BBG004731032", "LKOH", "TQBR", "INSTRUMENT_TYPE_SHARE", "share")
OFZ = I("3d9cc8b6-4a6c-4d5b-9f7c-1f6a2b5e7c01", "BBG00Y3XYV94", "SU26238RMFS4", "TQOB", "INSTRUMENT_TYPE_BOND", "bond")
OFZ29 = I("7c1e2a40-55b1-4f0e-9d3a-0b8f6c2d1e77", "BBG00R0Q6Y51", "SU29014RMFS6", "TQOB", "INSTRUMENT_TYPE_BOND", "bond")
TMOS = I("9654c2dd-6993-427e-80fa-04e80a1cf4da", "TCS60A101X76", "TMOS", "TQTF", "INSTRUMENT_TYPE_ETF", "etf")
# The same fund in another trading mode: another uid, FIGI and position uid, the same ISIN (seen in real data).
TMOS_AT = I("5b0d3e1f-7a2c-4c8e-9e11-2f4a6b8c0d12", "TCS00A101X76", "TMOS@", "SPBRU", "INSTRUMENT_TYPE_ETF", "etf")
# Operations carry the dollar's old uid; the directory knows only the new one (seen in real data).
USD_OLD = I("4f8a1b2c-0000-4000-8000-0000000000aa", "BBG0013HGFT4", "USD000UTSTOM", "CETS", "INSTRUMENT_TYPE_CURRENCY", "currency")
USD = dict(USD_OLD, uid="a22a1263-8e1b-4546-a1aa-416463f104d3")
RUB_UID = "a92e2e25-a698-45cc-a781-167cf465257c"
NONE = dict(uid="", figi="", ticker="", classCode="", kind="INSTRUMENT_TYPE_UNSPECIFIED", type="")
A1, A2, A3, A4 = "2000000001", "2000000002", "2000000003", "2000000004"

ops = []
cash = {}
held = {}
# Payments that never touch the account's cash: a security transfer carries its valuation,
# a dividend paid to a card leaves at once. A purchase «с карты» is paid from the account after a top-up.
NO_CASH = {"DIV_EXT"}


def op(acc, date, typ, name, payment, inst=NONE, qty=0, rest=0, price=0, parent="", state="EXECUTED", accrued=0, cur='rub', desc=None, same_id=None):
    # Broker ids are unique per account only: both sides of a transfer share one (seen in real data).
    item = {
        "cursor": "", "brokerAccountId": acc, "id": same_id or str(80000000000 + len(ops) + 1), "parentOperationId": parent,
        "name": name, "date": date, "type": "OPERATION_TYPE_" + typ, "description": desc or name,
        "state": "OPERATION_STATE_" + state, "instrumentUid": inst["uid"], "figi": inst["figi"],
        "instrumentType": inst["type"], "instrumentKind": inst["kind"], "positionUid": "", "ticker": inst["ticker"],
        "classCode": inst["classCode"], "payment": mv(payment, cur), "price": mv(price, cur), "commission": mv(0, cur),
        "yield": mv(0, cur), "yieldRelative": q(0), "accruedInt": mv(accrued, cur), "quantity": str(qty),
        "quantityRest": str(rest), "quantityDone": str(qty - rest), "cancelDateTime": "1970-01-01T00:00:00Z",
        "cancelReason": "", "assetUid": "", "childOperations": [],
    }
    ops.append(item)
    if state != "EXECUTED":
        return item["id"]
    security_transfer = typ == "TRANS_IIS_BS" and inst["uid"]
    if typ not in NO_CASH and not security_transfer:
        cash[(acc, cur)] = cash.get((acc, cur), D(0)) + D(str(payment))
    done = qty - rest
    if inst["uid"] and done:
        out = typ in ("SELL", "OUTPUT_SECURITIES") or (typ == "TRANS_IIS_BS" and D(str(payment)) < 0)
        key = (acc, inst["ticker"])
        held[key] = held.get(key, 0) + (-done if out else done)
    return item["id"]


def trade(acc, date, typ, inst, qty, price, fee, rest=0, accrued=0, name="Покупка ценных бумаг", state="EXECUTED"):
    amount = D(str(price)) * (qty - rest) + D(str(accrued))
    pid = op(acc, date, typ, name, -amount if typ.startswith("BUY") else amount, inst, qty, rest, price, accrued=accrued, state=state)
    if fee and state == "EXECUTED":
        op(acc, date, "BROKER_FEE", "Удержание комиссии за операцию", -D(str(fee)), inst, parent=pid)
    return pid


# Closed IIS: history only; at the end it moves everything to the broker account.
op(A3, "2020-01-20T09:00:00Z", "INPUT", "Пополнение брокерского счёта", 400000)
trade(A3, "2020-01-21T07:10:00Z", "BUY", SBER, 60, 255.4, 12.77)
trade(A3, "2020-02-03T08:00:00Z", "BUY", OFZ29, 20, 1012.5, 3.04, accrued=40.2)
op(A3, "2020-07-15T06:00:00Z", "COUPON", "Выплата купонов", 310.4, OFZ29)
op(A3, "2020-07-15T06:00:00Z", "BOND_TAX", "Удержание налога по купонам", -40, OFZ29)
op(A3, "2021-03-02T10:00:00Z", "TRACK_MFEE", "Комиссия за управление по стратегии автоследования", -120.5)
t1 = op(A3, "2023-07-05T20:59:00Z", "TRANS_IIS_BS", "Сбер Банк", -15600, SBER, 60, price=260, desc="Перевод 60 акций Сбер Банк")
t2 = op(A3, "2023-07-05T20:59:00Z", "TRANS_IIS_BS", "ОФЗ 29014", -20250, OFZ29, 20, price=1012.5, desc="Перевод 20 облигаций ОФЗ 29014")
moved = cash[(A3, 'rub')]
t3 = op(A3, "2023-07-05T20:59:00Z", "TRANS_IIS_BS", "", -moved, desc="Перевод денежных средств")

# Broker account.
op(A1, "2023-07-05T20:59:00Z", "TRANS_IIS_BS", "Сбер Банк", 15600, SBER, 60, price=260, desc="Перевод 60 акций Сбер Банк", same_id=t1)
op(A1, "2023-07-05T20:59:00Z", "TRANS_IIS_BS", "ОФЗ 29014", 20250, OFZ29, 20, price=1012.5, desc="Перевод 20 облигаций ОФЗ 29014", same_id=t2)
op(A1, "2023-07-05T20:59:00Z", "TRANS_IIS_BS", "", moved, desc="Перевод денежных средств", same_id=t3)
op(A1, "2023-07-10T09:12:00Z", "INPUT", "Пополнение брокерского счёта", 300000)
trade(A1, "2023-07-11T07:30:11Z", "BUY", SBER, 40, 250, 7.5)
trade(A1, "2023-08-01T08:05:42Z", "BUY", OFZ, 10, 605.5, 1.82, accrued=85.9)
trade(A1, "2023-08-02T10:00:00Z", "BUY", USD_OLD, 100, 82.15, 24.65, name="Покупка валюты")
trade(A1, "2023-08-03T11:00:00Z", "BUY", LKOH, 2, 5400, 2.7, rest=1)  # an order for 2, one filled
trade(A1, "2023-08-04T11:00:00Z", "BUY", SBER, 10, 300, 0, state="CANCELED")
op(A1, "2023-08-07T08:59:00Z", "INPUT", "Пополнение брокерского счёта", 3050, desc="Пополнение с карты для покупки")
trade(A1, "2023-08-07T09:00:00Z", "BUY_CARD", TMOS, 500, 6.1, 0.92, name="Покупка ценных бумаг с карты")
op(A1, "2024-01-17T06:00:00Z", "COUPON", "Выплата купонов", 356.5, OFZ)
op(A1, "2024-01-17T06:00:00Z", "BOND_TAX", "Удержание налога по купонам", -46, OFZ)
op(A1, "2024-07-26T06:00:00Z", "DIVIDEND", "Выплата дивидендов", 3315, SBER)
op(A1, "2024-07-26T06:00:00Z", "DIVIDEND_TAX", "Удержание налога по дивидендам", -431, SBER)
op(A1, "2024-10-03T06:00:00Z", "DIV_EXT", "Выплата дивидендов", 1200, LKOH, desc="Выплата дивидендов по акциям Лукойл на карту")
trade(A1, "2025-03-05T12:40:00Z", "SELL", SBER, 20, 290, 1.74, name="Продажа ценных бумаг")
op(A1, "2025-04-01T00:00:00Z", "SERVICE_FEE", "Комиссия за обслуживание счёта", -99)
op(A1, "2025-12-31T00:00:00Z", "TAX", "", -1820, desc="Удержание налога")
op(A1, "2026-01-20T00:00:00Z", "TAX_CORRECTION", "", 240, desc="Корректировка налога по ставке 13%")
op(A1, "2026-03-25T06:00:00Z", "BOND_REPAYMENT_FULL", "ОФЗ 29014", 20000, OFZ29, desc="Погашение ОФЗ 29014")  # no quantity
held[(A1, OFZ29["ticker"])] = 0
op(A1, "2026-05-20T09:00:00Z", "OUTPUT", "Вывод денежных средств", -10000)
op(A1, "2026-06-01T09:00:00Z", "SOMETHING_NEW", "Новый вид операции", -5, desc="Тип, которого нет в таблице соответствия")

# IIS.
op(A2, "2025-07-05T09:00:00Z", "INPUT", "Пополнение ИИС", 100000)
trade(A2, "2025-07-06T07:15:00Z", "BUY", TMOS, 10000, 6.9, 20.7)


def dump(name, data):
    with open(OUT + name, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write('\n')


dump('operations.json', {"operations": ops})


def account(id_, typ, name, status, opened, closed="1970-01-01T00:00:00Z"):
    return {"id": id_, "type": "ACCOUNT_TYPE_" + typ, "name": name, "status": "ACCOUNT_STATUS_" + status,
            "openedDate": opened, "closedDate": closed, "accessLevel": "ACCOUNT_ACCESS_LEVEL_READ_ONLY"}


dump('accounts.json', {"accounts": [
    account(A1, "TINKOFF", "Брокерский счёт", "OPEN", "2023-07-04T00:00:00Z"),
    account(A2, "TINKOFF_IIS", "ИИС", "OPEN", "2025-07-04T00:00:00Z"),
    account(A3, "TINKOFF_IIS", "ИИС", "CLOSED", "2020-01-17T00:00:00Z", "2023-07-17T00:00:00Z"),
    account(A4, "DFA", "ЦФА", "OPEN", "2025-05-23T00:00:00Z"),
]})


def ins(i, name, isin, lot, extra=None):
    d = {"uid": i["uid"], "figi": i["figi"], "ticker": i["ticker"], "classCode": i["classCode"], "isin": isin, "lot": lot,
         "currency": "rub", "name": name, "exchange": "MOEX", "instrumentType": i["type"], "instrumentKind": i["kind"],
         "positionUid": "", "countryOfRisk": "RU"}
    d.update(extra or {})
    return d


def bond(nominal, maturity):
    return {"nominal": mv(nominal), "initialNominal": mv(1000), "maturityDate": maturity, "couponQuantityPerYear": 2,
            "floatingCouponFlag": False, "amortizationFlag": False, "perpetualFlag": False}


dump('instruments.json', {"instruments": [
    ins(SBER, "Сбер Банк", "RU0009029540", 10),
    ins(LKOH, "Лукойл", "RU0009024277", 1),
    ins(OFZ, "ОФЗ 26238", "RU000A1038V6", 1, bond(1000, "2041-05-15T00:00:00Z")),
    ins(OFZ29, "ОФЗ 29014", "RU000A101N52", 1, bond(0, "2026-03-25T00:00:00Z")),
    ins(TMOS, "Т-Капитал Индекс МосБиржи", "RU000A101X76", 1),
    ins(TMOS_AT, "Т-Капитал Индекс МосБиржи", "RU000A101X76", 1),
    ins(USD, "Доллар США", "", 1000, {"isoCurrencyName": "usd", "nominal": mv(1, "usd")}),
]})

by_ticker = {i["ticker"]: i for i in [SBER, LKOH, OFZ, OFZ29, TMOS, USD]}
# The broker's average price, for the «current positions only» start.
avg_price = {"SBER": 255, "LKOH": 5400, "SU26238RMFS4": 605.5, "TMOS": 6.89, "USD000UTSTOM": 82.15}
# The IIS bought TMOS, the broker shows its holding as TMOS@.
shown_as = {(A2, "TMOS"): TMOS_AT}
last = {"SBER": 300, "LKOH": 7100, "SU26238RMFS4": 62.4, "TMOS": 7.1, "USD000UTSTOM": 81.2}


def portfolio(a):
    positions = []
    for (acc, ticker), qty in sorted(held.items()):
        if acc == a and qty:
            i = shown_as.get((acc, ticker), by_ticker[ticker])
            positions.append({"figi": i["figi"], "instrumentType": i["type"], "quantity": q(qty), "instrumentUid": i["uid"],
                              "positionUid": "", "ticker": i["ticker"], "classCode": i["classCode"], "currentPrice": mv(last[ticker]),
                              "averagePositionPrice": mv(avg_price.get(ticker, last[ticker]))})
    for (acc, cur), amount in sorted(cash.items()):
        if acc == a:
            positions.append({"figi": "RUB000UTSTOM", "instrumentType": "currency", "quantity": q(amount), "instrumentUid": RUB_UID,
                              "positionUid": "", "ticker": "RUB000UTSTOM", "classCode": "", "currentPrice": mv(1), "averagePositionPrice": mv(1)})
    return {"accountId": a, "positions": positions}


dump('portfolio.json', {A1: portfolio(A1), A2: portfolio(A2)})
dump('last-prices.json', {**{by_ticker[t]["uid"]: q(p) for t, p in last.items()}, TMOS_AT["uid"]: q(7.1)})


def coupon(n, date):
    return {"figi": OFZ["figi"], "couponDate": date + "T00:00:00Z", "couponNumber": str(n), "fixDate": date + "T00:00:00Z",
            "payOneBond": mv(35.65), "couponType": "COUPON_TYPE_CONSTANT", "couponPeriod": 182}


dump('coupons.json', {OFZ["uid"]: [coupon(n, d) for n, d in enumerate(
    ["2024-01-17", "2024-07-17", "2025-01-15", "2025-07-16", "2026-01-14", "2026-07-15", "2027-01-13", "2027-07-14"], 1)]})


def dividend(net, pay, record):
    return {"dividendNet": mv(net), "paymentDate": pay + "T00:00:00Z", "declaredDate": record + "T00:00:00Z",
            "lastBuyDate": record + "T00:00:00Z", "dividendType": "Regular Cash", "recordDate": record + "T00:00:00Z",
            "regularity": "Annual", "closePrice": mv(300), "yieldValue": q(11.1), "createdAt": record + "T00:00:00Z"}


dump('dividends.json', {SBER["uid"]: [dividend(33.3, "2025-07-28", "2025-07-18"), dividend(36.5, "2026-10-28", "2026-10-18")]})

API = "tinkoff.public.invest.api.contract.v1."
dump('tariff.json', {"unaryLimits": [
    {"limitPerMinute": 50, "methods": [API + "UsersService/GetAccounts", API + "UsersService/GetUserTariff"]},
    {"limitPerMinute": 200, "methods": [API + "OperationsService/GetOperationsByCursor", API + "OperationsService/GetPortfolio"]},
    {"limitPerMinute": 200, "methods": [API + "InstrumentsService/" + m for m in ["GetInstrumentBy", "BondBy", "GetBondCoupons", "GetDividends", "FindInstrument"]]},
    {"limitPerMinute": 600, "methods": [API + "MarketDataService/GetLastPrices", API + "MarketDataService/GetCandles"]},
], "streamLimits": []})

print(len(ops), "operations;", {f"{a}/{c}": str(v) for (a, c), v in cash.items()})
