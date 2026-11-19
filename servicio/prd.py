"""Consultas de lectura al PRD y parsers sin acceso a red."""
import ctypes
from ctypes import wintypes
from datetime import datetime
import json
import sys


class _CREDENTIAL(ctypes.Structure):
    _fields_ = [("Flags", wintypes.DWORD), ("Type", wintypes.DWORD), ("TargetName", wintypes.LPWSTR),
                ("Comment", wintypes.LPWSTR), ("LastWritten", wintypes.FILETIME), ("CredentialBlobSize", wintypes.DWORD),
                ("CredentialBlob", ctypes.POINTER(ctypes.c_ubyte)), ("Persist", wintypes.DWORD),
                ("AttributeCount", wintypes.DWORD), ("Attributes", ctypes.c_void_p), ("TargetAlias", wintypes.LPWSTR),
                ("UserName", wintypes.LPWSTR)]


def credencial(nombre):
    if sys.platform != "win32":
        return None
    advapi = ctypes.WinDLL("advapi32", use_last_error=True)
    advapi.CredReadW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
                                ctypes.POINTER(ctypes.POINTER(_CREDENTIAL))]
    advapi.CredReadW.restype = wintypes.BOOL
    advapi.CredFree.argtypes = [ctypes.c_void_p]
    p = ctypes.POINTER(_CREDENTIAL)()
    if not advapi.CredReadW(nombre, 1, 0, ctypes.byref(p)):
        return None
    try:
        c = p.contents
        return c.UserName or "", ctypes.string_at(c.CredentialBlob, c.CredentialBlobSize).decode("utf-16-le")
    finally:
        advapi.CredFree(p)


def iniciar_sesion(page, base, cred):
    page.goto(base + "Login.aspx", timeout=30000)
    page.fill("#txtUsuario", cred[0])
    page.fill("#txtPassword", cred[1])
    page.click("#btnEntrar")
    try:
        page.wait_for_url(lambda u: "login.aspx" not in u.lower(), timeout=30000)
    except Exception:
        raise RuntimeError("No se pudo iniciar sesión; revisa la credencial guardada de Windows.") from None
    page.goto(base + "Reportes/RendimientoAserraderoV2.aspx", timeout=60000)
    page.wait_for_load_state("networkidle", timeout=60000)


def consultar_dia(page, fecha):
    f = str(fecha)
    if "login.aspx" in page.url.lower():
        raise RuntimeError("La sesión PRD expiró")
    return page.evaluate("""async (datos) => {
        const r = await fetch(location.pathname + '/Datos', {method:'POST', credentials:'same-origin',
          headers:{'Content-Type':'application/json; charset=utf-8'}, body:JSON.stringify(datos)});
        if (r.url.toLowerCase().includes('login.aspx')) throw new Error('Sesión PRD expirada');
        if (!r.ok) throw new Error('Datos respondió ' + r.status);
        return await r.text();
    }""", {"desde": f, "hasta": f, "inicio": "00:00", "fin": "23:59"})


def _respuesta_prd(texto):
    t = texto.lstrip("\ufeff").strip()
    if t.startswith("200|"):
        t = t[4:]
    d = json.loads(t)
    d = d.get("d", d)
    d = json.loads(d) if isinstance(d, str) else d
    if not isinstance(d, dict) or not isinstance(d.get("Datos"), dict):
        raise ValueError("Respuesta del PRD sin Datos válidos")
    return d


def _iso(valor):
    return datetime.fromisoformat(valor).isoformat(timespec="seconds") if valor else None


def _horas(d, fecha):
    """Producción, consumo y trozos (PRD y PLC) por hora de un día; sirve para medir el atraso de registro de paquetes."""
    horas = {}
    for filas, campos in ((d["Datos"].get("Horas") or [], (("produccion", "Produccion"),
            ("consumo", "Consumo"), ("trozos", "Trozos"))),
            (d.get("ContadorHoras") or [], (("trozosPLC", "TrozosPLC"),))):
        for x in filas:
            if str(x.get("Hora", ""))[:10] != fecha:
                continue
            h = str(x["Hora"])[11:13] + ":00"
            fila = horas.setdefault(h, {"h": h, "produccion": 0, "consumo": 0, "trozos": 0, "trozosPLC": 0})
            for k, c in campos:
                fila[k] += x.get(c) or 0
    return [horas[h] for h in sorted(horas)]


def _dia(d, fecha):
    datos = d["Datos"]
    filas = [x for x in datos.get("Dias") or [] if str(x.get("Dia", ""))[:10] == fecha]
    r = {"f": fecha, **{k: sum(x.get(c) or 0 for x in filas) for k, c in
         (("produccion", "Produccion"), ("consumo", "Consumo"), ("trozos", "Trozos"),
          ("piezas", "Piezas"), ("tickets", "Tickets"))}, "productos": [], "diametros": [], "pilas": []}
    if filas:
        r["productos"] = [{"codigo": x.get("Codigo") or "", "esc": x.get("Descripcion") or "",
            "calidad": x.get("Calidad") or "", "m3": x.get("M3") or 0,
            "piezas": x.get("Piezas") or 0, "paq": x.get("Tickets") or 0} for x in datos.get("Productos") or []]
        r["diametros"] = [{"d": x.get("Diametro") or 0, "largo": x.get("Largo") or 0,
            "trozos": x.get("Trozos") or 0, "m3": x.get("M3") or 0} for x in datos.get("Diametros") or []]
        r["pilas"] = [{"pila": x.get("Pila") or "", "produccion": x.get("Produccion") or 0,
            "consumo": x.get("Consumo") or 0, "trozos": x.get("Trozos") or 0,
            "paq": x.get("Tickets") or 0} for x in datos.get("Pilas") or []]
    r["trozosPLC"] = sum(x.get("TrozosPLC") or 0 for x in d.get("ContadorDias") or []
                         if str(x.get("Dia", ""))[:10] == fecha)
    r["horas"] = _horas(d, fecha)
    return r


def parse_dia(texto, fecha):
    return _dia(_respuesta_prd(texto), str(fecha))


def parse_hoy(texto, fecha):
    fecha = str(fecha)
    d = _respuesta_prd(texto)
    r = _dia(d, fecha)
    tag = (d.get("Config") or {}).get("ContadorTagId")
    sensor = next((x for x in d.get("Sensores") or [] if tag is not None and x.get("TagId") == tag), None)
    r.update(ahora=_iso(d.get("Ahora")), trozosPLC=sum(x.get("TrozosPLC") or 0
        for x in d.get("ContadorDias") or [] if str(x.get("Dia", ""))[:10] == fecha),
        escuadriasHora=[{"h": str(x["Hora"])[11:13] + ":00", "pila": x.get("Pila") or "",
            "esc": x.get("Escuadria") or "", "m3": x.get("Produccion") or 0, "piezas": x.get("Piezas") or 0}
            for x in d["Datos"].get("EscuadriasHora") or [] if str(x.get("Hora", ""))[:10] == fecha],
        sensor={"nombre": sensor.get("TagName"), "estado": sensor.get("Status") if sensor.get("Fresco", True) else "Sin señal",
            "valor": sensor.get("Valor"), "visto": _iso(sensor.get("LastSeenTime"))} if sensor else
            {"nombre": "Sin sensor", "estado": "Sin sensor", "valor": None, "visto": None})
    calidad = d["Datos"].get("Calidad") or {}
    r["calidad"] = {k: int(calidad.get(c) or 0) for k, c in (
        ("paquetesSinTurno", "TicketsSinFechaTurno"),
        ("paquetesFueraHorario", "TicketsFueraHorario"),
        ("consumosFueraHorario", "ConsumosFueraHorario"))}
    sensor = r["sensor"]
    r["plcMuestras"] = ([{"t": sensor["visto"], "valor": int(sensor["valor"])}]
        if sensor["estado"] not in ("Sin señal", "Sin sensor") else [])
    return r
