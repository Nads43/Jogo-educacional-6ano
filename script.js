'use strict';

/* =====================================================
   CONFIGURAÇÕES
   ===================================================== */
const CONFIG = {
    WIDTH: 480,
    HEIGHT: 600,
    LEVEL_H: 125,        // distância vertical entre um nível e outro
    GROUND_Y: 520,       // topo do chão (nível 0) em coordenadas do mundo
    WALL_L: 32,          // limites da montanha
    WALL_R: 448,
    MAX_LIVES: 3,
    LEAD_TO_WIN: 5,      // vantagem de níveis que decide a partida
    GRAVITY: 0.6,
    JUMP: -13.5,         // altura do pulo ~152px (maior que LEVEL_H = 125)
    SPEED: 4.5,
    STEP: 1000 / 60,     // física em passo fixo (60 atualizações/s em qualquer monitor)
    PLAYER_W: 32,
    PLAYER_H: 38,
    HIT_INSET: 6,        // hitbox dos pés: ignora 6px de cada lado do sprite
    FATALITY_TIME: 20,   // segundos para o vencedor digitar uma sequência do livro
    NAME_FRAMES: 150,    // quanto tempo o nome do fatality fica na tela (60 = 1s)
    REVEAL_FRAMES: 110   // depois de um erro, quanto tempo a conta certa fica na tela
};

// jogador controlado pelo computador (modo "CPU")
const CPU = {
    ACCURACY: 0.8,       // chance de escolher a nuvem certa
    THINK_BASE: 50,      // tempo para "pensar" antes de andar (60 = 1s)...
    THINK_PER_LEVEL: 25, // ...mais um pouco para cada nível de dificuldade das contas
    THINK_RANDOM: 70     // ...e um pouco de sorte
};

/* =====================================================
   TECLADO
   ===================================================== */
const keys = {};
const BLOCKED_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'];

window.addEventListener('keydown', e => {
    if (BLOCKED_KEYS.includes(e.code)) e.preventDefault();
    keys[e.code] = true;
});
window.addEventListener('keyup', e => { keys[e.code] = false; });
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

/* =====================================================
   FUNÇÕES AUXILIARES
   ===================================================== */
const rnd = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// número "aleatório" fixo para cada i (as cenas ficam sempre iguais, sem piscar)
const prand = i => { const s = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return s - Math.floor(s); };
// altura (topo da plataforma) do nível k em coordenadas do mundo
const levelTop = k => CONFIG.GROUND_Y - k * CONFIG.LEVEL_H;

// mistura duas cores "#rrggbb" (t = 0 -> a, t = 1 -> b)
function mixHex(a, b, t) {
    const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    const ch = s => Math.round(((pa >> s) & 255) + (((pb >> s) & 255) - ((pa >> s) & 255)) * t);
    return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

/* =====================================================
   SONS SIMPLES (sem arquivos externos)
   ===================================================== */
let audioCtx = null;
let soundOn = true;                                  // muda pelo botão 🔊 no topo da tela
function beep(freq, dur, type, vol, slide) {
    if (!soundOn) return;
    try {
        audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
        const t0 = audioCtx.currentTime;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = type || 'square';
        osc.frequency.setValueAtTime(freq, t0);
        if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
        gain.gain.setValueAtTime(vol || 0.05, t0);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(t0);
        osc.stop(t0 + dur);
    } catch (e) { /* sem áudio, tudo bem */ }
}

function playSfx(name) {
    switch (name) {
        case 'key':     beep(700, 0.07, 'square', 0.04); break;
        case 'select':  beep(880, 0.08, 'square', 0.04, 200); break;
        case 'wrong':   beep(160, 0.18, 'sawtooth', 0.05, -60); break;
        case 'punch':   beep(180, 0.09, 'square', 0.08, -90); break;
        case 'thump':   beep(120, 0.35, 'sine', 0.14, -80); break;
        case 'crash':   beep(220, 0.25, 'sawtooth', 0.07, -150); break;
        case 'whoosh':  beep(320, 1.0, 'sawtooth', 0.03, -220); break;
        case 'rumble':  beep(70, 0.9, 'sawtooth', 0.05, -30); break;
        case 'screech': beep(1900, 0.4, 'square', 0.035, -1000); break;
        case 'name':    beep(220, 0.3, 'square', 0.07, 220); setTimeout(() => beep(110, 0.5, 'sawtooth', 0.07, -40), 250); break;
        case 'start':   beep(520, 0.12, 'square', 0.05, 200); break;
    }
}

/* =====================================================
   LUZ DE FUNDO (céu e "iluminação" da montanha)
   ===================================================== */
const LIGHTS = {
    dia:   { icon: '☀️', label: 'DIA',        hint: 'Céu azul e montanha bem iluminada',  sky: ['#4f86f7', '#a8d4ff'], shade: 'rgba(40, 15, 0, 0.30)',  stars: false },
    tarde: { icon: '🌇', label: 'PÔR DO SOL', hint: 'Céu laranja e roxo do fim da tarde', sky: ['#5b2a86', '#ff9a4d'], shade: 'rgba(110, 30, 60, 0.42)', stars: false },
    noite: { icon: '🌙', label: 'NOITE',      hint: 'Céu estrelado e montanha escura',    sky: ['#060a24', '#283a80'], shade: 'rgba(5, 10, 55, 0.62)',   stars: true }
};
const LIGHT_ORDER = ['dia', 'tarde', 'noite'];

/* =====================================================
   PERSONAGENS (pixel art 16 colunas, cada pixel vira 2x2)
   Cada letra é uma cor da paleta; "." é transparente.
   Os desenhos olham para a DIREITA.
   ===================================================== */
const MARIO_MAP = [
    '.....RRRRR......',
    '....RRRRRRRRR...',
    '....HHHSSkS.....',
    '...HSHSSSkSSS...',
    '...HSHHSSSkSSS..',
    '...HHSSSSkkkk...',
    '.....SSSSSSS....',
    '....RRBRRR......',
    '...RRRBRRBRRR...',
    '..RRRRBBBBRRRR..',
    '..SSRBYBBYBRSS..',
    '..SSSBBBBBBSSS..',
    '..SSBBBBBBBBSS..',
    '....BBB..BBB....',
    '...NNN....NNN...',
    '..NNNN....NNNN..'
];
// Luigi: mesmo desenho, mas um pouco mais alto (pernas mais compridas)
const LUIGI_MAP = [...MARIO_MAP.slice(0, 12), MARIO_MAP[12], ...MARIO_MAP.slice(12)];

const CHARACTERS = {
    mario: {
        name: 'MARIO', full: 'MARIO', hud: '#FF5555', main: '#E52521',
        palette: { R: '#E52521', B: '#2038EC', S: '#FFC8A0', H: '#6B3A10', k: '#000000', Y: '#FFD700', N: '#6B3A10' },
        map: MARIO_MAP
    },
    luigi: {
        name: 'LUIGI', full: 'LUIGI', hud: '#55FF55', main: '#20B020',
        palette: { R: '#20B020', B: '#1D2FB8', S: '#FFC8A0', H: '#6B3A10', k: '#000000', Y: '#FFD700', N: '#6B3A10' },
        map: LUIGI_MAP
    },
    peach: {
        name: 'PEACH', full: 'PRINCESA PEACH', hud: '#FF8AC8', main: '#FF8AC8',
        palette: { C: '#FFB000', O: '#E0004D', Y: '#FFD83A', S: '#FFD9B8', b: '#2A6CF0', D: '#E0457B', P: '#FF8AC8', B: '#3A7CFF', W: '#FFFFFF' },
        map: [
            '......CCOCC.....',
            '......CCCCC.....',
            '....YYYYYYYY....',
            '...YYYYYSSSSY...',
            '...YYYYSSbSbS...',
            '...YYYYSSSSSS...',
            '..YYYYYSSSDSS...',
            '..YYYYYYSSSS....',
            '..YYYYYPPPP.....',
            '..YYYYPPBPPP....',
            '...YYPPPPPPPS...',
            '...WWPPPPPPWW...',
            '....PPPDPPPP....',
            '....PPPPDPPPP...',
            '...PPPPPPDPPP...',
            '...PPPPPPPDPPP..',
            '..PPPPPPPPPPPPP.',
            '..DDDDDDDDDDDDD.',
            '....DD....DD....'
        ]
    },
    toad: {
        name: 'TOAD', full: 'TOAD', hud: '#FFFFFF', main: '#E52521',
        palette: { W: '#FFFFFF', R: '#E52521', S: '#FFD9B8', k: '#000000', B: '#2050D0', Y: '#FFD700', N: '#7A3B12' },
        map: [
            '.....WWWWWW.....',
            '...WWRRWWRRWW...',
            '..WRRRRWWRRRRW..',
            '..WRRRRWWRRRRW..',
            '.WWRRWWWWWWRRWW.',
            '.WWWWWWWWWWWWWW.',
            '..WWWSSSSSSWWW..',
            '....SSkSSkSS....',
            '....SSkSSkSS....',
            '.....SSSSSS.....',
            '...BBYBBBBYBB...',
            '..SSBBBBBBBBSS..',
            '....WWWWWWWW....',
            '...NNNN..NNNN...'
        ]
    },
    yoshi: {
        name: 'YOSHI', full: 'YOSHI', hud: '#7CFC7C', main: '#3CC83C',
        palette: { G: '#3CC83C', W: '#FFFFFF', k: '#000000', R: '#E52521', O: '#FF8C1A' },
        map: [
            '........GGGG....',
            '.......GWWGGG...',
            '......GGWkGGGGG.',
            '.....GGGWkGGGGGG',
            '.....GGGGGGGGGGG',
            '......GGGGGGGGG.',
            '.......GGGWWWW..',
            '....RRRGGWWW....',
            '...RRRRRGWWW....',
            '..WRRRRGGWWWGG..',
            '..WWWGGGGWWW....',
            '..GGGGGGGWWW....',
            '.GGG.GGGGGGG....',
            'GG...GGGGGG.....',
            '......GG.GG.....',
            '.....OOO.OOO....',
            '....OOOO.OOOO...'
        ]
    },
    bowser: {
        name: 'BOWSER', full: 'BOWSER', hud: '#FFB347', main: '#E8B030',
        palette: { W: '#F5F5F0', R: '#FF6B1A', Y: '#E8B030', k: '#000000', G: '#2E9E3A', O: '#F5E3A0' },
        map: [
            '...W.RRR..W.....',
            '...WRRRRRRW.....',
            '...RRYYYYYR.....',
            '..RRYYkYYkY.....',
            '..RRYYYYYYYYY...',
            '...RYYWYWYWYY...',
            '..WGWYYYYYYY....',
            '.GWGWGYYYYYY....',
            'GGGGGGOOOOOOYY..',
            'GWGGGGOOOOOOYYY.',
            'GGGWGGOOOOOO.WW.',
            'GGGGGGOOOOOO....',
            '.GGGGGOOOOOO....',
            '..GGGYYYYYYY....',
            '...YYYYY.YYYY...',
            '..YYYY....YYYY..',
            '..WWW......WWW..'
        ]
    },
    rosalina: {
        name: 'ROSALINA', full: 'ROSALINA', hud: '#7FE0F0', main: '#7FE0F0',
        palette: { M: '#E0E8F0', Y: '#FFE680', S: '#FFE4CC', k: '#1A3F8F', P: '#FF8AA0', C: '#7FE0F0', L: '#4FB8D8', W: '#FFFFFF' },
        map: [
            '......M.M.......',
            '.....MMMMM......',
            '....YYYYYYY.....',
            '...YYYYYYSSS....',
            '...YYYYYSSkS....',
            '...YYYYYSSSS....',
            '...YYYYSSSPS....',
            '...YYYYYSSS.....',
            '...YYYCCCCC.....',
            '...YYCCLCCCC....',
            '...YSSCCCCCSS...',
            '....SSCCLCCSS...',
            '....CCCCLCCCC...',
            '...CCCCCLCCCCC..',
            '...CCCCCCLCCCC..',
            '..CCCCCCCLCCCCC.',
            '..CCCCCCCCCCCCC.',
            '..LLLLLLLLLLLLL.',
            '....WW....WW....'
        ]
    },
    dk: {
        name: 'DONKEY KONG', full: 'DONKEY KONG', hud: '#D2955B', main: '#7A4520',
        palette: { N: '#7A4520', T: '#E8B888', k: '#000000', R: '#E52521', Y: '#FFD700' },
        map: [
            '....NNNNNN......',
            '...NNNNNNNN.....',
            '..NNNTTTTTNN....',
            '..NNTkTTkTTN....',
            '..NNTTTTTTTT....',
            '..NNTTkkTTTT....',
            '...NTTTTTTTN....',
            '.NNNNNTTTNNNNN..',
            'NNNNNNRRRNNNNNN.',
            'NNNNNRRYRRNNNNN.',
            'NN.NNRRRRRNN.NN.',
            'TT.NNNRRRNNN.TT.',
            'TT.NNNNNNNNN.TT.',
            '...NNNNNNNNN....',
            '...NNNN.NNNN....',
            '..TTTT...TTTT...'
        ]
    }
};
const CHAR_ORDER = ['mario', 'luigi', 'peach', 'toad', 'yoshi', 'bowser', 'rosalina', 'dk'];

const OUTLINE = '#1A0F08';
const spriteCache = {};

// transforma o mapa de letras em uma imagem (com contorno escuro em volta)
function buildSprite(map, pal, airborne) {
    const PX = 2, COLS = 16;
    let rows = map.map(r => (r + '.'.repeat(COLS)).slice(0, COLS));
    // no ar: as pernas (3 últimas linhas) se abrem para os lados
    if (airborne) rows = rows.map((r, i) => i < rows.length - 3 ? r : r.slice(1, 8) + '..' + r.slice(8, 15));

    const filled = (x, y) => y >= 0 && y < rows.length && x >= 0 && x < COLS && pal[rows[y][x]];
    const c = document.createElement('canvas');
    c.width = (COLS + 2) * PX;
    c.height = (rows.length + 2) * PX;
    const g = c.getContext('2d');

    g.fillStyle = OUTLINE;
    for (let y = -1; y <= rows.length; y++) {
        for (let x = -1; x <= COLS; x++) {
            if (!filled(x, y) && (filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1))) {
                g.fillRect((x + 1) * PX, (y + 1) * PX, PX, PX);
            }
        }
    }
    for (let y = 0; y < rows.length; y++) {
        for (let x = 0; x < COLS; x++) {
            const color = filled(x, y);
            if (!color) continue;
            g.fillStyle = color;
            g.fillRect((x + 1) * PX, (y + 1) * PX, PX, PX);
        }
    }
    return c;
}

/* =====================================================
   IMAGENS DOS PERSONAGENS (opcional)
   Coloque arquivos PNG com fundo transparente na pasta "img/" com estes nomes.
   Se um arquivo não existir, o jogo usa o desenho em pixel art acima.
   - file:       personagem parado
   - jump:       personagem pulando (opcional)
   - facesRight: true se a imagem olha para a DIREITA, false se olha para a esquerda
   - height:     altura na tela, em pixels (o chão do jogo é desenhado para 38)
   ===================================================== */
const SPRITE_FILES = {
    mario:    { file: 'img/mario.png',    jump: 'img/mario-pulo.png',    facesRight: true, height: 38 },
    luigi:    { file: 'img/luigi.png',    jump: 'img/luigi-pulo.png',    facesRight: true, height: 40 },
    peach:    { file: 'img/peach.png',    jump: 'img/peach-pulo.png',    facesRight: true, height: 40 },
    toad:     { file: 'img/toad.png',     jump: 'img/toad-pulo.png',     facesRight: true, height: 32 },
    yoshi:    { file: 'img/yoshi.png',    jump: 'img/yoshi-pulo.png',    facesRight: true, height: 40 },
    bowser:   { file: 'img/bowser.png',   jump: 'img/bowser-pulo.png',   facesRight: false, height: 52 },
    rosalina: { file: 'img/rosalina.png', jump: 'img/rosalina-pulo.png', facesRight: true, height: 44 },
    dk:       { file: 'img/dk.png',       jump: 'img/dk-pulo.png',       facesRight: true, height: 44 }
};
const loadedImages = {};

// redimensiona a imagem sem borrar (pixel art) e vira para a direita se precisar
function buildSpriteFromImage(img, cfg) {
    const h = cfg.height || CONFIG.PLAYER_H;
    const w = Math.max(1, Math.round(img.naturalWidth * h / img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h + 2;                                // 2px livres embaixo, igual aos desenhos em pixel art
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    if (cfg.facesRight === false) { g.translate(w, 0); g.scale(-1, 1); }
    g.drawImage(img, 0, 0, w, h);
    return c;
}

// tenta carregar as imagens da pasta img/; onLoad é chamado a cada imagem que chega
function loadCharacterImages(onLoad) {
    Object.keys(SPRITE_FILES).forEach(id => {
        const cfg = SPRITE_FILES[id];
        [['stand', cfg.file], ['jump', cfg.jump]].forEach(([kind, src]) => {
            if (!src) return;
            const img = new Image();
            img.onload = () => {
                (loadedImages[id] = loadedImages[id] || {})[kind] = img;
                delete spriteCache[id];
                delete spriteCache[id + '_air'];
                onLoad();
            };
            img.src = src;                           // se o arquivo não existir, nada acontece
        });
    });
}

function getSprite(id, airborne) {
    const key = id + (airborne ? '_air' : '');
    if (!spriteCache[key]) {
        const imgs = loadedImages[id];
        if (imgs && imgs.stand) {
            spriteCache[key] = buildSpriteFromImage((airborne && imgs.jump) || imgs.stand, SPRITE_FILES[id]);
        } else {
            const c = CHARACTERS[id] || CHARACTERS.mario;
            spriteCache[key] = buildSprite(c.map, c.palette, airborne);
        }
    }
    return spriteCache[key];
}

// desenha o personagem em um <canvas> pequeno do menu (diminui se não couber)
function drawPreview(canvas, id) {
    const g = canvas.getContext('2d');
    const spr = getSprite(id, false);
    const s = Math.min(1, (canvas.width - 2) / spr.width, (canvas.height - 2) / spr.height);
    const w = Math.round(spr.width * s), h = Math.round(spr.height * s);
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.drawImage(spr, Math.floor((canvas.width - w) / 2), canvas.height - h - 1, w, h);
}

/* =====================================================
   PERGUNTAS - 5 níveis de dificuldade (6º ano)
   1: somas e subtrações até 10        (ex.: 7 + 2)
   2: dezenas e tabuada até 5          (ex.: 24 + 13, 4 × 6)
   3: tabuada completa e divisão exata (ex.: 7 × 8, 56 ÷ 7)
   4: contas maiores                   (ex.: 58 ÷ 2, 14 × 6)
   5: potências e expressões numéricas (ex.: 5², 4 + 3 × 2)
   Dentro de uma partida os números crescem um pouco a cada nível.
   ===================================================== */
const DIFFICULTIES = [
    { name: 'MUITO FÁCIL',   ex: '7 + 2' },
    { name: 'FÁCIL',         ex: '24 + 13' },
    { name: 'MÉDIO',         ex: '7 × 8' },
    { name: 'DIFÍCIL',       ex: '58 ÷ 2' },
    { name: 'MUITO DIFÍCIL', ex: '4 + 3 × 2' }
];

const OPS_BY_DIFFICULTY = {
    1: ['+', '+', '-'],
    2: ['+', '-', '×'],
    3: ['+', '-', '×', '×', '÷', '÷'],
    4: ['+', '-', '×', '×', '÷', '÷'],
    5: ['×', '÷', '^', 'expr', 'expr', '÷']
};

function generateQuestion(diff, level) {
    const r = Math.min(1, 0.5 + level * 0.05);          // a faixa de números cresce até o nível 10
    const up = (min, max) => rnd(min, Math.max(min, Math.round(min + (max - min) * r)));
    const ops = OPS_BY_DIFFICULTY[diff] || OPS_BY_DIFFICULTY[1];
    const op = ops[rnd(0, ops.length - 1)];
    let text, answer, trap = null;                      // trap = erro comum (vira uma das opções erradas)

    if (op === '+') {
        let a, b;
        if (diff === 1) { a = rnd(1, 9); b = rnd(1, 9); }
        else if (diff === 2) { a = up(10, 50); b = up(2, 30); }
        else if (diff === 3) { a = up(20, 99); b = up(10, 99); }
        else { a = up(100, 600); b = up(20, 400); }
        text = `${a} + ${b}`; answer = a + b;
    } else if (op === '-') {
        let a, b;
        if (diff === 1) { a = rnd(3, 10); b = rnd(1, a - 1); }
        else if (diff === 2) { a = up(15, 60); b = rnd(2, a - 5); }
        else if (diff === 3) { a = up(40, 99); b = rnd(10, a - 5); }
        else { a = up(150, 900); b = rnd(20, a - 20); }
        text = `${a} - ${b}`; answer = a - b;
    } else if (op === '×') {
        let a, b;
        if (diff === 2) { a = rnd(2, 5); b = up(2, 10); }
        else if (diff === 3) { a = up(2, 10); b = up(2, 10); }
        else if (diff === 4) { a = up(11, 25); b = rnd(2, 9); }
        else { a = up(12, 30); b = up(3, 12); }
        text = `${a} × ${b}`; answer = a * b;
    } else if (op === '÷') {
        let b, q;
        if (diff === 3) { b = up(2, 10); q = up(2, 10); }
        else if (diff === 4) { b = rnd(2, 9); q = up(11, 30); }      // ex.: 58 ÷ 2
        else { b = up(3, 12); q = up(12, 40); }
        text = `${b * q} ÷ ${b}`; answer = q;
    } else if (op === '^') {
        if (Math.random() < 0.65) {
            const a = up(2, 12);
            text = `${a}²`; answer = a * a; trap = a * 2;          // erro comum: 5² = 10
        } else {
            const a = up(2, 5);
            text = `${a}³`; answer = a * a * a; trap = a * 3;
        }
    } else {
        // expressões numéricas: treinam a ordem das operações
        const form = rnd(0, 3);
        if (form === 0) {
            const a = up(2, 20), b = rnd(2, 9), c = up(2, 9);
            text = `${a} + ${b} × ${c}`; answer = a + b * c; trap = (a + b) * c;
        } else if (form === 1) {
            const a = up(2, 12), b = up(2, 12), c = rnd(2, 6);
            text = `(${a} + ${b}) × ${c}`; answer = (a + b) * c; trap = a + b * c;
        } else if (form === 2) {
            const a = rnd(3, 9), b = up(3, 9), c = rnd(2, Math.min(20, a * b - 1));
            text = `${a} × ${b} - ${c}`; answer = a * b - c; trap = b > c ? a * (b - c) : null;
        } else {
            const b = rnd(2, 9), q = up(2, 12), c = up(2, 20);
            text = `${b * q} ÷ ${b} + ${c}`; answer = q + c;
            const t = (b * q) / (b + c);
            trap = Number.isInteger(t) ? t : null;
        }
    }

    // duas respostas erradas, diferentes e não negativas
    const options = [answer];
    if (trap != null && trap >= 0 && trap !== answer) options.push(trap);
    const steps = answer < 20 ? [1, 2, 3] : answer < 100 ? [1, 2, 3, 10] : [1, 2, 10, 20];
    let tries = 0;
    while (options.length < 3 && tries++ < 100) {
        const wrong = answer + steps[rnd(0, steps.length - 1)] * (Math.random() > 0.5 ? 1 : -1);
        if (wrong >= 0 && !options.includes(wrong)) options.push(wrong);
    }
    options.sort(() => Math.random() - 0.5);

    return { questionText: text, answer, options };
}

/* =====================================================
   GRÁFICOS BÁSICOS
   ===================================================== */
function createTilePattern() {
    const c = document.createElement('canvas');
    c.width = 32; c.height = 32;
    const g = c.getContext('2d');
    g.fillStyle = '#C87038'; g.fillRect(0, 0, 32, 32);
    g.fillStyle = '#682000'; g.fillRect(0, 0, 32, 2); g.fillRect(0, 0, 2, 32);
    g.fillStyle = '#E89050'; g.fillRect(2, 2, 28, 2); g.fillRect(2, 2, 2, 28);
    return c;
}
const tilePatternCanvas = createTilePattern();

// (x, y) = canto superior esquerdo da caixa do personagem; os pés terminam em y + 38
function drawPixelCharacter(ctx, x, y, charId, facingRight, airborne) {
    const spr = getSprite(charId, airborne);
    ctx.save();
    ctx.translate(Math.floor(x), Math.floor(y));
    if (!facingRight) {
        ctx.scale(-1, 1);
        ctx.translate(-CONFIG.PLAYER_W, 0);
    }
    // centralizado na caixa do personagem, com os pés no chão
    ctx.drawImage(spr, Math.round((CONFIG.PLAYER_W - spr.width) / 2), CONFIG.PLAYER_H + 2 - spr.height);
    ctx.restore();
}

// personagem com escala/rotação em volta dos pés (cx, fy = centro dos pés)
function drawCharT(ctx, cx, fy, charId, facingRight, airborne, o) {
    o = o || {};
    const sx = o.sx == null ? 1 : o.sx;
    const sy = o.sy == null ? 1 : o.sy;
    ctx.save();
    ctx.translate(cx, fy);
    ctx.rotate(o.rot || 0);
    ctx.scale(sx, sy);
    drawPixelCharacter(ctx, -CONFIG.PLAYER_W / 2, -CONFIG.PLAYER_H, charId, facingRight, airborne);
    ctx.restore();
}

// personagem girando em volta do próprio centro
function drawCharC(ctx, cx, cy, charId, facingRight, airborne, rot) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot || 0);
    drawPixelCharacter(ctx, -CONFIG.PLAYER_W / 2, -CONFIG.PLAYER_H / 2, charId, facingRight, airborne);
    ctx.restore();
}

function drawStar(ctx, x, y, r, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4;
        const rr = i % 2 === 0 ? r : r * 0.4;
        ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
}

function drawPixelCloud(ctx, cloud) {
    const { x, y, w, h } = cloud;
    ctx.save();
    ctx.globalAlpha = cloud.alpha;

    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.fillRect(x + 4, y + 6, w, h);

    // vermelha = resposta errada escolhida; verde = resposta certa mostrada depois do erro
    ctx.fillStyle = cloud.wrongHit ? '#FF6666' : (cloud.reveal ? '#7CFC7C' : '#FFFFFF');
    ctx.fillRect(x + 8, y, w - 16, h);
    ctx.fillRect(x, y + 8, w, h - 16);

    ctx.fillStyle = cloud.wrongHit ? '#8B0000' : (cloud.reveal ? '#1B7A1B' : '#B0C4DE');
    ctx.fillRect(x + 8, y, w - 16, 3);          // borda do topo (onde se pisa)
    ctx.fillRect(x + 8, y + h - 3, w - 16, 3);

    ctx.fillStyle = '#000';
    ctx.font = 'bold 14px "Press Start 2P", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(cloud.value, x + w / 2, y + h / 2 + 2);
    ctx.restore();
}

// plataforma do nível k (sólida apenas para o nível atual do jogador)
function drawLedge(ctx, k) {
    const y = levelTop(k);
    const x = CONFIG.WALL_L;
    const w = CONFIG.WALL_R - CONFIG.WALL_L;

    if (k === 0) {
        ctx.fillStyle = '#8B4A1A';
        ctx.fillRect(x, y, w, 400);
    }
    ctx.fillStyle = '#2E7D32';
    ctx.fillRect(x, y, w, 14);
    ctx.fillStyle = '#55D14F';
    ctx.fillRect(x, y, w, 5);
    ctx.fillStyle = '#1B4D1E';
    ctx.fillRect(x, y + 14, w, 3);
}

/* =====================================================
   CENAS DE FATALITY (desenhadas na tela do perdedor)
   Cada cena recebe (g, ctx, f, t): jogo, contexto, estado do fatality
   e o tempo t em passos (60 por segundo).
   ===================================================== */

/* ---- 1) BIGORNA ---- */
function drawAnvil(ctx, cx, yb, topW, label) {
    ctx.save();
    ctx.fillStyle = '#2b2b30';
    ctx.fillRect(cx - 26, yb - 10, 52, 10);              // base
    ctx.fillRect(cx - 14, yb - 26, 28, 16);              // cintura
    ctx.fillStyle = '#4a4a52';
    ctx.fillRect(cx - topW / 2, yb - 46, topW, 20);      // mesa
    ctx.fillRect(cx - topW / 2 - 14, yb - 42, 16, 10);   // bico
    ctx.fillStyle = '#8a8a94';
    ctx.fillRect(cx - topW / 2, yb - 46, topW, 4);       // brilho
    ctx.fillStyle = '#FFD700';
    ctx.font = '10px "Press Start 2P", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, cx, yb - 34);
    ctx.restore();
}

function sceneAnvil(g, ctx, f, t) {
    const L = f.loser;
    const cx = L.x + CONFIG.PLAYER_W / 2, FY = CONFIG.GROUND_Y;
    const TI = 55;                                   // instante do impacto
    const label = `${f.weight} TON`;
    const topW = Math.max(76, label.length * 10 + 16);

    let sx = 1, sy = 1, jx = 0;
    if (t < TI) {
        const s = t / TI;                            // sombra crescendo no chão
        ctx.fillStyle = `rgba(0,0,0,${0.12 + 0.28 * s})`;
        ctx.beginPath();
        ctx.ellipse(cx, FY, 12 + (topW / 2) * s, 4 + 4 * s, 0, 0, Math.PI * 2);
        ctx.fill();
        if (t > TI - 25) jx = Math.sin(t * 1.7) * 2.2;   // tremendo de medo
    } else {
        const q = clamp((t - TI) / 6, 0, 1);          // achatado (rebaixado)
        sy = 1 - 0.84 * q;
        sx = 1 + 1.0 * q;
    }
    drawCharT(ctx, cx + jx, FY, L.char, L.facingRight, false, { sx, sy });

    let yb;
    if (t < TI) {
        const s = t / TI;
        yb = -70 + ((FY - 38) + 70) * s * s;          // cai acelerando
    } else {
        const d = t - TI - 6;
        const bounce = d > 0 ? Math.max(0, 8 * Math.sin(d * 0.35)) * Math.exp(-d / 10) : 0;
        yb = FY - 38 * sy - bounce;
    }
    drawAnvil(ctx, cx, yb, topW, label);

    if (t >= TI) {
        const d = t - TI;
        if (d < 35) {                                  // poeira do impacto
            ctx.fillStyle = `rgba(232,217,176,${1 - d / 35})`;
            for (let i = 0; i < 10; i++) {
                const dir = i < 5 ? -1 : 1, k = i % 5;
                ctx.beginPath();
                ctx.arc(cx + dir * (24 + d * (1.2 + k * 0.45)), FY - 4 - d * 0.35 * k, 4 + d * 0.25, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        if (t > TI + 14) {                             // estrelinhas girando
            for (let i = 0; i < 3; i++) {
                const a = t * 0.12 + i * 2.094;
                drawStar(ctx, cx + Math.cos(a) * 34, yb - 56 + Math.sin(a) * 8, 6, '#FFD700');
            }
        }
    }
}

/* ---- 2) TSUNAMI em pixel art (da direita para a esquerda, só do lado do perdedor) ---- */
function sceneTsunami(g, ctx, f, t) {
    const L = f.loser;
    const W = CONFIG.WIDTH, FY = CONFIG.GROUND_Y;
    const P = 8;                                     // tamanho de cada "pixel" da onda
    const H = 296, LEN = 304, SPEED = 5;
    const front = W + 10 - t * SPEED;
    const tc = (W + 10 - (L.x + 34)) / SPEED;        // instante em que a onda alcança o perdedor
    const dt = t - tc;
    const hAt = x => {
        const u = (x - front) / LEN;
        if (u < 0 || u > 1) return 0;
        return H * (u < 0.12 ? Math.sqrt(u / 0.12) : Math.exp(-(u - 0.12) * 3.2));
    };
    const snap = v => Math.round(v / P) * P;

    // água: uma coluna de blocos de 8px por vez, com faixas de cor
    let crest = null;
    for (let x = Math.floor(front / P) * P; x < front + LEN; x += P) {
        const h = snap(hAt(x + P / 2));
        if (h <= 0) continue;
        const top = FY - h, col = Math.round(x / P);
        if (!crest || top < crest.top) crest = { x, top };

        ctx.fillStyle = '#0B3D91'; ctx.fillRect(x, top, P, 640 - top);           // água funda
        ctx.fillStyle = '#1565D8'; ctx.fillRect(x, top, P, Math.min(h, 12 * P)); // água média
        ctx.fillStyle = '#3D9BFF'; ctx.fillRect(x, top, P, Math.min(h, 4 * P));  // água clara
        ctx.fillStyle = '#9BE0FF'; ctx.fillRect(x, top, P, Math.min(h, 2 * P));
        ctx.fillStyle = '#FFFFFF'; ctx.fillRect(x, top, P, P);                   // espuma

        // brilhos que piscam dentro da água
        for (let k = 0; k < 3; k++) {
            if (prand(col * 13 + k * 7 + Math.floor(t / 8)) > 0.75) {
                const y = top + (5 + k * 5 + Math.floor(prand(col + k * 31) * 4)) * P;
                ctx.fillStyle = k === 0 ? '#7CC4FF' : '#2F7FF0';
                ctx.fillRect(x, y, P, P);
            }
        }
    }

    if (crest) {
        // crista enrolada para a frente (o "cachinho" da onda)
        if (crest.top < FY - 5 * P) {
            const lip = [[0, -1, '#FFFFFF'], [-1, -1, '#FFFFFF'], [-1, 0, '#FFFFFF'], [-2, 0, '#FFFFFF'],
                         [-2, 1, '#9BE0FF'], [-3, 1, '#FFFFFF'], [-3, 2, '#FFFFFF'], [-1, 1, '#3D9BFF']];
            lip.forEach(([dx, dy, c]) => { ctx.fillStyle = c; ctx.fillRect(crest.x + dx * P, crest.top + dy * P, P, P); });
        }
        // gotas de espuma voando à frente da onda
        ctx.fillStyle = '#FFFFFF';
        for (let i = 0; i < 10; i++) {
            const life = (t * 2 + i * 9) % 40;
            const x = Math.round((crest.x - 16 - life * (1 + prand(i) * 1.5)) / 4) * 4;
            const y = Math.round((crest.top - 8 - life * 0.8 + life * life * 0.09) / 4) * 4;
            ctx.fillRect(x, y, P / 2, P / 2);
        }
    }

    // perdedor: assustado e depois levado pela onda, girando de 90 em 90 graus
    if (dt < 0) {
        const jx = front - L.x < 160 ? Math.sin(t * 2) * 2 : 0;
        drawCharT(ctx, L.x + 16 + jx, FY, L.char, L.facingRight, false);
    } else {
        const b = clamp(dt / 10, 0, 1);
        const xc = (L.x + 16) + b * ((front + 24) - (L.x + 16));
        const cy = FY - 19 - b * (60 + 30 * Math.sin(dt * 0.1));
        const rot = -Math.floor(dt / 6) * Math.PI / 2;
        if (xc > -50) drawCharC(ctx, Math.round(xc), Math.round(cy), L.char, false, true, rot);
    }
}

/* ---- 3) PAREDE QUEBRADA + PISÃO NA CABEÇA ----
   O vencedor sai andando da própria tela, entra na tela do perdedor pela borda do meio,
   soca a parede até ela quebrar e pula na cabeça do perdedor. É sempre UM personagem só. */
const WALL = { TE: 60, TK: 78, TB: 98, TA: 40 };   // sai da tela, chega na parede, quebra, voo

function wallLayout(g, f) {
    const dir = f.winner === g.p1 ? 1 : -1;          // P1 está à esquerda: entra pela esquerda da tela do P2
    const W = CONFIG.WIDTH;
    const wx = dir > 0 ? 70 : W - 70 - 64;           // parede de 2 colunas x 7 linhas
    return {
        dir, wx,
        enterX: dir > 0 ? -24 : W + 24,              // onde ele aparece na tela do perdedor
        stopX: dir > 0 ? wx - 14 : wx + 64 + 14      // onde ele para para socar a parede
    };
}

// tela do VENCEDOR: ele anda até a borda que encosta na tela do adversário e sai
function wallWinnerSide(g, ctx, f, t) {
    if (t >= WALL.TE) return;
    const Wn = f.winner, FY = CONFIG.GROUND_Y;
    const { dir } = wallLayout(g, f);
    const x0 = Wn.x + 16, x1 = dir > 0 ? CONFIG.WIDTH + 24 : -24;
    const s = clamp((t - 6) / (WALL.TE - 6), 0, 1);
    const walking = t >= 6;
    drawCharT(ctx, Math.round(x0 + (x1 - x0) * s), FY, Wn.char, dir > 0, walking && Math.floor(t / 5) % 2 === 1);
}

function sceneWall(g, ctx, f, t) {
    const L = f.loser, Wn = f.winner;
    const { dir, wx, enterX, stopX } = wallLayout(g, f);
    const FY = CONFIG.GROUND_Y;
    const { TE, TK, TB, TA } = WALL;
    const TI = TB + TA;                              // instante do pisão
    const cxL = L.x + 16, headY = FY - 38;
    const punchHit = t >= TK && t < TB && (t - TK) % 7 < 3;

    // perdedor
    let lsx = 1, lsy = 1, lrot = 0, jx = 0;
    if (t < TI) {
        jx = t > TK ? Math.sin(t * 1.9) * 2 : 0;
    } else {
        const j = t - TI;
        const q = clamp(j / 6, 0, 1);
        lsy = 1 - 0.45 * q; lsx = 1 + 0.25 * q;
        if (j >= 6) {
            const k = clamp((j - 6) / 26, 0, 1);
            lrot = dir * (Math.PI / 2) * (1 - Math.pow(1 - k, 3));
            lsx = 1; lsy = 1;
        }
    }
    const lfy = FY - 16 * Math.abs(Math.sin(lrot));

    // parede (balança a cada soco e depois explode em tijolos)
    if (t < TB) {
        const ox = punchHit ? dir * 2 : 0;
        for (let c = 0; c < 2; c++) {
            for (let r = 0; r < 7; r++) ctx.drawImage(tilePatternCanvas, wx + c * 32 + ox, FY - (r + 1) * 32);
        }
        if (punchHit) {
            ctx.fillStyle = '#FFF';
            ctx.font = '12px "Press Start 2P", monospace';
            ctx.textAlign = 'center';
            ctx.fillText('BAM!', wx + 32, FY - 250);
        }
    } else {
        const d = t - TB;
        for (let i = 0; i < 14; i++) {
            const c = i % 2, r = Math.floor(i / 2);
            const x0 = wx + c * 32, y0 = FY - (r + 1) * 32;
            const vx = dir * (1.2 + prand(i) * 3.3), vy = -(2 + prand(i + 30) * 7);
            const x = x0 + vx * Math.min(d, 25);
            const y = Math.min(y0 + vy * d + 0.45 * d * d, FY - 32);
            const rot = (prand(i + 60) - 0.5) * 0.4 * Math.min(d, 30);
            ctx.save();
            ctx.translate(x + 16, y + 16);
            ctx.rotate(rot);
            ctx.drawImage(tilePatternCanvas, -16, -16);
            ctx.restore();
        }
    }

    // perdedor (desenhado por cima dos tijolos para nunca ficar escondido)
    drawCharT(ctx, cxL + jx, lfy, L.char, L.facingRight, false, { sx: lsx, sy: lsy, rot: lrot });

    // vencedor: entra andando pela borda, soca a parede e pula na cabeça do perdedor
    if (t >= TE && t < TK) {
        const s = (t - TE) / (TK - TE);
        drawCharT(ctx, Math.round(enterX + (stopX - enterX) * s), FY, Wn.char, dir > 0, Math.floor(t / 5) % 2 === 1);
    } else if (t >= TK && t < TB) {
        drawCharT(ctx, stopX + (punchHit ? dir * 5 : 0), FY, Wn.char, dir > 0, punchHit);
    } else if (t >= TB) {
        let wxp, wfy, air = true;
        const s = (t - TB) / TA;
        if (s <= 1) {
            wxp = stopX + (cxL - stopX) * s;
            wfy = FY + (headY - FY) * s - 4 * 130 * s * (1 - s);
        } else {
            const j = t - TI;
            if (j < 6) {
                wxp = cxL; wfy = FY - 38 * lsy;
            } else {
                const jj = j - 6;
                wxp = cxL - dir * Math.min(jj, 30) * 0.8;
                wfy = (FY - 38 * 0.55) + (-9 * jj + 0.35 * jj * jj);
                if (wfy >= FY) { wfy = FY; air = false; }
            }
        }
        drawCharT(ctx, wxp, wfy, Wn.char, dir > 0, air);
    }

    // efeitos do impacto
    if (t >= TI && t < TI + 20) {
        const a = 1 - (t - TI) / 20;
        ctx.save();
        ctx.globalAlpha = a;
        drawStar(ctx, cxL, headY - 28, 20 + (t - TI), '#FFD700');
        ctx.fillStyle = '#C01010';
        ctx.font = '14px "Press Start 2P", monospace';
        ctx.textAlign = 'center';
        ctx.fillText('POW!', cxL, headY - 24);
        ctx.restore();
    }
    if (t >= TI + 26) {
        for (let i = 0; i < 3; i++) {
            const a = t * 0.14 + i * 2.094;
            drawStar(ctx, cxL + dir * 40 + Math.cos(a) * 18, FY - 30 + Math.sin(a) * 6, 5, '#FFD700');
        }
    }
}

/* ---- 4) AVALANCHE ---- */
function sceneAvalanche(g, ctx, f, t) {
    const L = f.loser;
    const W = CONFIG.WIDTH, FY = CONFIG.GROUND_Y, cx = L.x + 16;
    const HM = 78, HW = 100;                          // altura e meia-largura do monte de neve
    const gp = clamp((t - 60) / 90, 0, 1);            // quanto do monte já se formou
    const prof = x => { const d = (x - cx) / HW; return d * d >= 1 ? 0 : HM * Math.pow(1 - d * d, 0.75); };
    const surf = x => FY - prof(x) * gp;

    // perdedor
    const jx = (t > 20 && t < 60) ? Math.sin(t * 1.9) * 2 : 0;
    drawCharT(ctx, cx + jx, FY, L.char, L.facingRight, false);

    // pedaços de neve e pedras caindo
    for (let i = 0; i < 48; i++) {
        const ts = 20 + i * 2.7, d = t - ts;
        if (d < 0) continue;
        const x = cx + (prand(i) - 0.5) * 230;
        const r = 7 + prand(i + 9) * 15;
        const y = -40 + 6 * d + 0.12 * d * d;
        if (d > 3 && y + r >= surf(x) + 4) continue;   // já pousou no monte
        const rock = i % 7 === 3;
        ctx.fillStyle = rock ? '#6e6a66' : '#FFFFFF';
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = rock ? '#8b8680' : '#cfe3f5';
        ctx.beginPath(); ctx.arc(x - r * 0.25, y - r * 0.25, r * 0.55, 0, Math.PI * 2); ctx.fill();
    }

    // monte de neve cobrindo o perdedor
    if (gp > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(cx - HW, FY);
        for (let x = cx - HW; x <= cx + HW; x += 4) ctx.lineTo(x, surf(x) + Math.sin(x * 0.35) * 2.5 * gp);
        ctx.lineTo(cx + HW, FY);
        ctx.closePath();
        const grad = ctx.createLinearGradient(0, FY - HM, 0, FY);
        grad.addColorStop(0, '#FFFFFF');
        grad.addColorStop(1, '#bcd4ea');
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.strokeStyle = '#9fbfdc';
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.restore();
    }

    // só o "chapéu" (cor principal do personagem) aparece no topo
    if (gp >= 1) {
        ctx.fillStyle = CHARACTERS[L.char].main;
        ctx.fillRect(cx - 7, FY - HM - 7, 14, 7);
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(cx - 2, FY - HM - 11, 4, 4);
    }

    // neblina de neve e flocos
    if (t > 20 && t < 150) {
        ctx.fillStyle = 'rgba(255,255,255,0.16)';
        for (let i = 0; i < 6; i++) {
            const x = cx + (prand(i + 200) - 0.5) * 200;
            const y = 100 + (t - 20) * 2.5 * (0.3 + prand(i + 210));
            ctx.beginPath(); ctx.arc(x, y, 40 + prand(i + 220) * 30, 0, Math.PI * 2); ctx.fill();
        }
    }
    ctx.fillStyle = '#FFFFFF';
    for (let i = 0; i < 30; i++) {
        const x = prand(i + 100) * W;
        const y = (t * 2.2 * (0.5 + prand(i + 130)) + prand(i) * 600) % 600;
        ctx.fillRect(x, y, 3, 3);
    }
}

/* ---- 5) GAVIÃO ---- */
function drawHawk(ctx, x, y, t, grab) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(-1, 1);                                 // desenhado olhando para a direita, virado para a esquerda
    const fl = Math.sin(t * 0.45);
    const wing = (color, ox) => {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(8 + ox, -6);
        ctx.lineTo(-16 + ox, -6);
        ctx.lineTo(-42 + ox, -6 - 38 * fl);
        ctx.lineTo(-8 + ox, -6 - 26 * fl);
        ctx.closePath();
        ctx.fill();
    };
    wing('#4a2c12', 6);                               // asa de trás
    ctx.fillStyle = '#6b4423'; ctx.fillRect(-36, -5, 16, 9);   // cauda
    ctx.fillStyle = '#3a210c'; ctx.fillRect(-30, -5, 3, 9);
    ctx.fillStyle = '#7a4a1e'; ctx.fillRect(-22, -9, 44, 18);  // corpo
    ctx.fillStyle = '#e8cfa6'; ctx.fillRect(-6, 0, 28, 9);     // barriga
    ctx.fillStyle = '#7a4a1e'; ctx.fillRect(2, 3, 3, 3); ctx.fillRect(11, 5, 3, 3);
    ctx.fillStyle = '#7a4a1e'; ctx.fillRect(16, -17, 16, 15);  // cabeça
    ctx.fillStyle = '#f5f5f5'; ctx.fillRect(20, -14, 12, 3);   // sobrancelha
    ctx.fillStyle = '#000';    ctx.fillRect(26, -10, 3, 3);    // olho
    ctx.fillStyle = '#f2c200'; ctx.fillRect(32, -10, 9, 6); ctx.fillRect(38, -5, 3, 6); // bico
    ctx.fillStyle = '#f2c200';
    if (grab) { ctx.fillRect(2, 9, 4, 12); ctx.fillRect(10, 9, 4, 12); }   // garras abertas
    else { ctx.fillRect(2, 9, 4, 4); ctx.fillRect(10, 9, 4, 4); }
    wing('#5b3517', 0);                               // asa da frente
    ctx.restore();
}

function sceneHawk(g, ctx, f, t) {
    const L = f.loser;
    const W = CONFIG.WIDTH, FY = CONFIG.GROUND_Y, cx = L.x + 16;
    const TG = 70, END = 175;                         // instante do agarrão e fim da cena
    const bez = (p0, p1, p2, s) => ({
        x: (1 - s) * (1 - s) * p0.x + 2 * (1 - s) * s * p1.x + s * s * p2.x,
        y: (1 - s) * (1 - s) * p0.y + 2 * (1 - s) * s * p1.y + s * s * p2.y
    });
    const A0 = { x: W + 90, y: 40 }, A1 = { x: cx + 150, y: 380 }, A2 = { x: cx, y: FY - 54 };
    const B1 = { x: cx - 20, y: 200 }, B2 = { x: -140, y: -90 };
    const pos = t < TG ? bez(A0, A1, A2, t / TG) : bez(A2, B1, B2, clamp((t - TG) / (END - TG), 0, 1));

    if (t < TG) {                                     // sombra do gavião no chão
        const s = t / TG;
        ctx.fillStyle = `rgba(0,0,0,${0.15 + 0.2 * s})`;
        ctx.beginPath();
        ctx.ellipse(pos.x, FY, 14 + 26 * s, 4 + 2 * s, 0, 0, Math.PI * 2);
        ctx.fill();
        const jx = t > 40 ? Math.sin(t * 1.8) * 2 : 0;
        drawCharT(ctx, cx + jx, FY, L.char, L.facingRight, false);
    } else {                                          // perdedor pendurado nas garras
        ctx.save();
        ctx.translate(pos.x, pos.y + 14);
        ctx.rotate(Math.sin(t * 0.22) * 0.28);
        drawPixelCharacter(ctx, -16, 0, L.char, L.facingRight, true);
        ctx.restore();
    }

    drawHawk(ctx, pos.x, pos.y, t, t >= TG - 8);

    if (t > TG - 30 && t < TG + 10) {
        ctx.font = '10px "Press Start 2P", monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#000'; ctx.fillText('KREEE!', pos.x + 1, pos.y - 31);
        ctx.fillStyle = '#FFD700'; ctx.fillText('KREEE!', pos.x, pos.y - 32);
    }
    if (t >= TG) {                                    // penas caindo
        ctx.fillStyle = '#7a4a1e';
        for (let i = 0; i < 5; i++) {
            const d = t - TG;
            ctx.save();
            ctx.translate(cx + (prand(i) - 0.5) * 60 + Math.sin(d * 0.1 + i) * 10, FY - 40 + d * (0.6 + prand(i + 5) * 0.8));
            ctx.rotate(d * 0.1 + i);
            ctx.fillRect(-4, -1, 8, 2);
            ctx.restore();
        }
    }
}

/* =====================================================
   LIVRO DE FATALITY
   Direções: U = cima, D = baixo, L = esquerda, R = direita.
   P1 usa W/S/A/D e P2 usa as setas.
   Os nomes (trocadilhos) só aparecem DEPOIS da cena.
   ===================================================== */
const FATALITIES = [
    {   // 1) Bigorna
        id: 'anvil',
        title: 'BIGORNA DO CÉU',
        desc: 'Uma bigorna com o peso do resultado que o perdedor errou esmaga o coitado.',
        name: 'CONTA DE PESO',
        seq: ['U', 'U', 'D', 'D', 'L', 'R'],
        dur: 150,
        draw: sceneAnvil,
        shake: t => (t >= 55 && t < 75) ? 6 * (1 - (t - 55) / 20) : 0,
        sfx: { 55: 'thump' }
    },
    {   // 2) Tsunami
        id: 'tsunami',
        title: 'TSUNAMI',
        desc: 'Uma onda gigante passa e leva o perdedor, da direita para a esquerda.',
        name: 'DÍZIMA PERIÓDICA',
        seq: ['L', 'L', 'R', 'R', 'D', 'U'],
        dur: 165,
        draw: sceneTsunami,
        shake: (t, f) => {
            const tc = (CONFIG.WIDTH + 10 - (f.loser.x + 34)) / 5;
            return Math.abs(t - tc) < 25 ? 3 : 0;
        },
        sfx: { 20: 'whoosh' }
    },
    {   // 3) Parede
        id: 'wall',
        title: 'PISÃO PELA PAREDE',
        desc: 'O vencedor atravessa para a tela do outro, quebra a parede e pula na cabeça dele.',
        name: 'O PISÃO DE PI',
        seq: ['R', 'R', 'U', 'U', 'L', 'D'],
        dur: WALL.TB + WALL.TA + 107,
        draw: sceneWall,
        winnerDraw: wallWinnerSide,                  // o vencedor também anima na própria tela
        shake: t => {
            const TI = WALL.TB + WALL.TA;
            if (t >= WALL.TK && t < WALL.TB) return (t - WALL.TK) % 7 < 2 ? 2 : 0;
            if (t >= WALL.TB && t < WALL.TB + 10) return 4;
            if (t >= TI && t < TI + 14) return 6 * (1 - (t - TI) / 14);
            return 0;
        },
        sfx: {
            [WALL.TK]: 'punch', [WALL.TK + 7]: 'punch', [WALL.TK + 14]: 'punch',
            [WALL.TB]: 'crash', [WALL.TB + WALL.TA]: 'thump'
        }
    },
    {   // 4) Avalanche
        id: 'avalanche',
        title: 'AVALANCHE',
        desc: 'A montanha desaba e enterra o perdedor na neve.',
        name: 'ABAIXO DE ZERO',
        seq: ['D', 'D', 'U', 'U', 'R', 'L'],
        dur: 190,
        draw: sceneAvalanche,
        shake: t => t < 60 ? 2.5 : (t < 150 ? 1 + 3 * (1 - (t - 60) / 90) : 0),
        sfx: { 5: 'rumble', 60: 'rumble' }
    },
    {   // 5) Gavião
        id: 'hawk',
        title: 'GAVIÃO',
        desc: 'Um gavião mergulha, agarra o perdedor e some no céu.',
        name: 'RAPTO DE PRIMO',
        seq: ['U', 'L', 'U', 'R', 'D', 'D'],
        dur: 175,
        draw: sceneHawk,
        shake: t => (t >= 70 && t < 76) ? 2 : 0,
        sfx: { 70: 'screech' }
    }
];

const DIR_KEYS = {
    p1: { KeyW: 'U', KeyS: 'D', KeyA: 'L', KeyD: 'R' },
    p2: { ArrowUp: 'U', ArrowDown: 'D', ArrowLeft: 'L', ArrowRight: 'R' }
};
const KEY_LABEL = {
    p1: { U: 'W', D: 'S', L: 'A', R: 'D' },
    p2: { U: '↑', D: '↓', L: '←', R: '→' }
};
const CONTROLS = {
    p1: { left: 'KeyA', right: 'KeyD', jump: 'KeyW' },
    p2: { left: 'ArrowLeft', right: 'ArrowRight', jump: 'ArrowUp' }
};

/* =====================================================
   CONFIGURAÇÕES SALVAS (dificuldade, luz e personagens)
   ===================================================== */
const SETTINGS_KEY = 'mathclimb-settings';
const DEFAULT_SETTINGS = { difficulty: 2, light: 'dia', p1: 'mario', p2: 'luigi', mode: 'duo', sound: true };

function loadSettings() {
    const s = { ...DEFAULT_SETTINGS };
    try {
        const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
        if (saved.mode === 'duo' || saved.mode === 'cpu') s.mode = saved.mode;
        if (saved.sound === false) s.sound = false;
        if (saved.difficulty >= 1 && saved.difficulty <= 5) s.difficulty = saved.difficulty;
        if (LIGHTS[saved.light]) s.light = saved.light;
        if (CHARACTERS[saved.p1]) s.p1 = saved.p1;
        if (CHARACTERS[saved.p2] && saved.p2 !== s.p1) s.p2 = saved.p2;
    } catch (e) { /* sem armazenamento, usa o padrão */ }
    if (s.p1 === s.p2) s.p2 = CHAR_ORDER.find(id => id !== s.p1);
    return s;
}

function saveSettings(s) {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) { /* tudo bem */ }
}

/* =====================================================
   JOGO
   ===================================================== */
class MathClimbGame {
    constructor() {
        this.cP1 = document.getElementById('canvas-p1');
        this.ctxP1 = this.cP1.getContext('2d');
        this.cP2 = document.getElementById('canvas-p2');
        this.ctxP2 = this.cP2.getContext('2d');

        this.width = CONFIG.WIDTH;
        this.height = CONFIG.HEIGHT;
        [this.cP1, this.cP2].forEach(c => { c.width = this.width; c.height = this.height; });

        this.settings = loadSettings();
        soundOn = this.settings.sound;
        this.pickSlot = 'p1';                         // qual jogador está escolhendo personagem
        this.isRunning = false;
        this.paused = false;
        this.rafId = null;
        this.fatality = null;
        this.frame = 0;

        this.buildMenus();
        this.initEventListeners();
        this.initTouchControls();
        this.refreshMenu();
        this.fitToScreen();
        window.addEventListener('resize', () => this.fitToScreen());
        loadCharacterImages(() => this.redrawPreviews());
    }

    /* ---------------- CELULAR / TABLET ---------------- */
    initTouchControls() {
        const enableTouch = () => {
            if (document.body.classList.contains('touch')) return;
            document.body.classList.add('touch');
            this.fitToScreen();
        };
        if (window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0) enableTouch();
        window.addEventListener('touchstart', enableTouch, { passive: true });

        // botões de andar/pular: cada botão "segura" a tecla correspondente enquanto tem um dedo em cima.
        // Dá para escorregar o dedo de um botão para o outro e usar vários dedos ao mesmo tempo.
        document.querySelectorAll('.tbtn').forEach(btn => {
            const fingers = new Set();
            const sync = () => {
                keys[btn.dataset.key] = fingers.size > 0;
                btn.classList.toggle('on', fingers.size > 0);
            };
            const press = e => { e.preventDefault(); fingers.add(e.pointerId); sync(); };
            const release = e => { fingers.delete(e.pointerId); sync(); };

            btn.addEventListener('pointerdown', e => {
                if (btn.hasPointerCapture(e.pointerId)) btn.releasePointerCapture(e.pointerId);
                press(e);
            });
            btn.addEventListener('pointerenter', e => { if (e.pointerType === 'touch' || e.buttons) press(e); });
            ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => btn.addEventListener(ev, release));
            btn.addEventListener('contextmenu', e => e.preventDefault());
            window.addEventListener('blur', () => { fingers.clear(); sync(); });
        });

        // setas do livro de fatality
        document.querySelectorAll('.bpad').forEach(btn => {
            btn.addEventListener('pointerdown', e => {
                e.preventDefault();
                this.fatalityInput(btn.dataset.dir);
            });
        });

        // tela cheia (no celular esconde a barra do navegador e tenta deitar a tela)
        document.getElementById('fullscreen-btn').addEventListener('click', () => {
            const el = document.documentElement;
            try {
                if (document.fullscreenElement) { document.exitFullscreen(); return; }
                const req = el.requestFullscreen || el.webkitRequestFullscreen;
                const p = req && req.call(el);
                if (p && p.then) {
                    p.then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape'))
                     .catch(() => { /* o navegador não deixou, tudo bem */ });
                }
            } catch (e) { /* sem tela cheia, tudo bem */ }
        });
        document.addEventListener('fullscreenchange', () => setTimeout(() => this.fitToScreen(), 100));

        document.getElementById('rotate-ok-btn').addEventListener('click', () => {
            document.body.classList.add('portrait-ok');
        });
    }

    // mostra os botões de toque só enquanto a partida está rolando (sem livro, cena ou pausa)
    setPlayState() {
        document.body.classList.toggle('in-play', this.isRunning && !this.fatality && !this.paused);
    }

    /* ---------------- SOM E PAUSA ---------------- */
    updateSoundBtn() {
        const btn = document.getElementById('sound-btn');
        btn.innerText = soundOn ? '🔊' : '🔇';
        btn.title = soundOn ? 'Desligar o som' : 'Ligar o som';
    }

    toggleSound() {
        soundOn = !soundOn;
        this.settings.sound = soundOn;
        saveSettings(this.settings);
        this.updateSoundBtn();
        playSfx('select');
    }

    setPaused(value) {
        if (!this.isRunning || this.paused === value) return;
        this.paused = value;
        document.getElementById('pause-screen').classList.toggle('hidden', !value);
        for (const k in keys) keys[k] = false;       // nenhuma tecla fica "presa" ao voltar
        this.setPlayState();
        playSfx('key');
    }

    // sai da partida e volta para a tela inicial
    goToMenu() {
        if (this.rafId) cancelAnimationFrame(this.rafId);
        this.isRunning = false;
        this.paused = false;
        this.fatality = null;
        this.hideFatalityUI();
        this.setPlayState();
        this.refreshMenu();
        this.showScreen('start-screen');
    }

    redrawPreviews() {
        document.querySelectorAll('.char-card').forEach(card => drawPreview(card.querySelector('canvas'), card.dataset.char));
        this.refreshMenu();
    }

    /* ---------------- MENUS ---------------- */
    buildMenus() {
        document.getElementById('difficulty-choices').innerHTML = DIFFICULTIES.map((d, i) =>
            `<button class="choice-btn" data-diff="${i + 1}" title="${d.name}">${i + 1}</button>`).join('');

        document.getElementById('light-choices').innerHTML = LIGHT_ORDER.map(id =>
            `<button class="choice-btn light-btn" data-light="${id}" title="${LIGHTS[id].label}">${LIGHTS[id].icon}<span>${LIGHTS[id].label}</span></button>`).join('');

        document.getElementById('char-grid').innerHTML = CHAR_ORDER.map(id => `
            <button class="char-card" data-char="${id}">
                <canvas width="40" height="48"></canvas>
                <span class="char-name">${CHARACTERS[id].full}</span>
            </button>`).join('');
        document.querySelectorAll('.char-card').forEach(card => drawPreview(card.querySelector('canvas'), card.dataset.char));
    }

    refreshMenu() {
        const s = this.settings;
        const diff = DIFFICULTIES[s.difficulty - 1];

        document.querySelectorAll('[data-diff]').forEach(b => b.classList.toggle('active', Number(b.dataset.diff) === s.difficulty));
        document.getElementById('difficulty-hint').innerText = `${diff.name} • ex.: ${diff.ex}`;

        document.querySelectorAll('[data-light]').forEach(b => {
            if (b.classList.contains('choice-btn')) b.classList.toggle('active', b.dataset.light === s.light);
        });
        document.getElementById('light-hint').innerText = LIGHTS[s.light].hint;
        document.body.dataset.light = s.light;

        // jogador 2: amigo ou computador
        document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === s.mode));
        document.getElementById('p2-tag').innerText = s.mode === 'cpu' ? 'COMPUTADOR 🤖' : 'JOGADOR 2';
        document.body.classList.toggle('solo', s.mode === 'cpu');
        this.updateSoundBtn();

        ['p1', 'p2'].forEach(slot => {
            const ch = CHARACTERS[s[slot]];
            document.getElementById(`${slot}-card-name`).innerText = ch.full;
            document.getElementById(`pick-${slot}-name`).innerText = ch.name;
            drawPreview(document.getElementById(`preview-${slot}`), s[slot]);
        });

        document.querySelectorAll('.pick-tab').forEach(t => t.classList.toggle('active', t.dataset.slot === this.pickSlot));
        document.querySelectorAll('.char-card').forEach(card => {
            const id = card.dataset.char;
            card.classList.toggle('p1', s.p1 === id);
            card.classList.toggle('p2', s.p2 === id);
            card.querySelectorAll('.char-badge').forEach(b => b.remove());
            ['p1', 'p2'].forEach(slot => {
                if (s[slot] === id) card.insertAdjacentHTML('beforeend', `<span class="char-badge ${slot}">${slot.toUpperCase()}</span>`);
            });
        });
    }

    pickCharacter(id, card) {
        const other = this.pickSlot === 'p1' ? 'p2' : 'p1';
        if (this.settings[other] === id) {             // já é do outro jogador
            playSfx('wrong');
            card.classList.remove('shake');
            void card.offsetWidth;
            card.classList.add('shake');
            return;
        }
        this.settings[this.pickSlot] = id;
        playSfx('select');
        if (this.pickSlot === 'p1') this.pickSlot = 'p2';   // depois do P1, é a vez do P2
        saveSettings(this.settings);
        this.refreshMenu();
    }

    showScreen(id) {
        ['start-screen', 'char-screen', 'game-over-screen', 'pause-screen'].forEach(s =>
            document.getElementById(s).classList.toggle('hidden', s !== id));
    }

    isVisible(id) { return !document.getElementById(id).classList.contains('hidden'); }

    initEventListeners() {
        const $ = id => document.getElementById(id);
        $('start-btn').addEventListener('click', () => this.startGame());
        $('restart-btn').addEventListener('click', () => this.startGame());
        $('menu-btn').addEventListener('click', () => this.goToMenu());
        $('pause-menu-btn').addEventListener('click', () => this.goToMenu());
        $('resume-btn').addEventListener('click', () => this.setPaused(false));
        $('pause-btn').addEventListener('click', () => this.setPaused(true));
        $('sound-btn').addEventListener('click', () => this.toggleSound());

        $('mode-choices').addEventListener('click', e => {
            const b = e.target.closest('[data-mode]');
            if (!b) return;
            this.settings.mode = b.dataset.mode;
            playSfx('select');
            saveSettings(this.settings);
            this.refreshMenu();
        });

        // trocou de aba ou minimizou o navegador: pausa sozinho
        document.addEventListener('visibilitychange', () => { if (document.hidden) this.setPaused(true); });
        $('chars-btn').addEventListener('click', () => { this.pickSlot = 'p1'; this.refreshMenu(); this.showScreen('char-screen'); });
        $('chars-ok-btn').addEventListener('click', () => this.showScreen('start-screen'));

        $('difficulty-choices').addEventListener('click', e => {
            const b = e.target.closest('[data-diff]');
            if (!b) return;
            this.settings.difficulty = Number(b.dataset.diff);
            playSfx('select');
            saveSettings(this.settings);
            this.refreshMenu();
        });
        $('light-choices').addEventListener('click', e => {
            const b = e.target.closest('.choice-btn[data-light]');
            if (!b) return;
            this.settings.light = b.dataset.light;
            playSfx('select');
            saveSettings(this.settings);
            this.refreshMenu();
        });
        $('char-grid').addEventListener('click', e => {
            const card = e.target.closest('.char-card');
            if (card) this.pickCharacter(card.dataset.char, card);
        });
        document.querySelectorAll('.pick-tab').forEach(tab => tab.addEventListener('click', () => {
            this.pickSlot = tab.dataset.slot;
            playSfx('key');
            this.refreshMenu();
        }));

        window.addEventListener('keydown', e => {
            this.onFatalityKey(e);
            if (this.isVisible('char-screen') && (e.code === 'Enter' || e.code === 'Escape')) {
                e.preventDefault();
                this.showScreen('start-screen');
                return;
            }
            if ((e.code === 'KeyP' || e.code === 'Escape') && this.isRunning && !e.repeat) {
                e.preventDefault();
                this.setPaused(!this.paused);
                return;
            }
            if (e.code !== 'Enter') return;
            if (this.isVisible('start-screen') || this.isVisible('game-over-screen')) {
                e.preventDefault();
                this.startGame();
            }
        });
    }

    // aumenta ou reduz o jogo para caber na janela (sem barra de rolagem)
    fitToScreen() {
        const stage = document.getElementById('stage');
        const box = document.getElementById('game-container');
        const head = document.querySelector('.site-header');
        const foot = document.querySelector('.site-footer');
        const gap = document.body.classList.contains('touch') ? 4 : 16;   // no celular aproveita cada pixel
        const used = (head ? head.offsetHeight : 0) + (foot ? foot.offsetHeight : 0) + gap * 2;
        const scale = Math.max(0.2, Math.min((window.innerWidth - gap) / 960, (window.innerHeight - used) / 600, 1.5));
        stage.style.width = `${960 * scale}px`;
        stage.style.height = `${600 * scale}px`;
        box.style.transform = `scale(${scale})`;
    }

    /* ---------------- PARTIDA ---------------- */
    nameOf(p) { return CHARACTERS[p.char].name; }

    /* ---------------- CONTROLES ---------------- */
    // o que o jogador está apertando neste instante (teclado/toque ou computador)
    readInput(p) {
        if (p.cpu) return this.cpuInput(p);
        const c = CONTROLS[p.slot];
        return { left: !!keys[c.left], right: !!keys[c.right], jump: !!keys[c.jump] };
    }

    // "cérebro" do computador: pensa um pouco, escolhe uma nuvem, anda até ela e pula
    cpuInput(p) {
        const inp = { left: false, right: false, jump: false };
        if (p.reveal > 0 || !p.clouds.length) return inp;

        let plan = p.cpuPlan;
        if (!plan || plan.q !== p.currentQuestion) {
            const correct = p.clouds.find(c => c.isCorrect);
            const wrongs = p.clouds.filter(c => !c.isCorrect);
            const right = Math.random() < CPU.ACCURACY || !wrongs.length;
            p.cpuPlan = {
                q: p.currentQuestion,
                target: right ? correct : wrongs[rnd(0, wrongs.length - 1)],
                wait: CPU.THINK_BASE + this.settings.difficulty * CPU.THINK_PER_LEVEL + rnd(0, CPU.THINK_RANDOM),
                cooldown: 0
            };
            return inp;
        }
        if (plan.wait > 0) { plan.wait--; return inp; }

        const targetX = plan.target.x + plan.target.w / 2 - p.w / 2;
        const dx = targetX - p.x;
        if (Math.abs(dx) > CONFIG.SPEED) {
            inp.left = dx < 0;
            inp.right = dx > 0;
        } else if (p.onGround && plan.cooldown-- <= 0) {
            inp.jump = true;
            plan.cooldown = 30;
        }
        return inp;
    }

    // Cada jogador recebe a sua própria conta. Evita repetir as últimas contas do mesmo
    // jogador e também a conta que o adversário está resolvendo agora.
    newQuestionFor(player) {
        const other = player === this.p1 ? this.p2 : this.p1;
        const avoid = new Set(player.history);
        if (other && other.currentQuestion) avoid.add(other.currentQuestion.questionText);

        let q;
        for (let i = 0; i < 40; i++) {
            q = generateQuestion(this.settings.difficulty, player.level);
            if (!avoid.has(q.questionText)) break;
        }
        player.history.push(q.questionText);
        if (player.history.length > 15) player.history.shift();
        return q;
    }

    createPlayer(slot) {
        return {
            slot,
            char: this.settings[slot],
            cpu: slot === 'p2' && this.settings.mode === 'cpu',
            cpuPlan: null,
            reveal: 0,           // > 0 enquanto a conta certa está sendo mostrada depois de um erro
            stats: { right: 0, wrong: 0, mistakes: [] },
            x: 220,
            y: CONFIG.GROUND_Y - CONFIG.PLAYER_H,
            prevY: CONFIG.GROUND_Y - CONFIG.PLAYER_H,
            w: CONFIG.PLAYER_W, h: CONFIG.PLAYER_H,
            vx: 0, vy: 0,
            onGround: true,
            facingRight: true,
            level: 0,
            lives: CONFIG.MAX_LIVES,
            cameraY: 0,
            currentQuestion: null,
            clouds: [],
            floats: [],
            history: [],
            lastWrong: null      // último resultado errado (vira o peso da bigorna)
        };
    }

    startGame() {
        this.showScreen(null);
        this.hideFatalityUI();

        if (this.rafId) cancelAnimationFrame(this.rafId);

        this.fatality = null;
        this.p1 = this.createPlayer('p1');
        this.p2 = this.createPlayer('p2');
        this.generateLevelClouds(this.p1);
        this.generateLevelClouds(this.p2);

        // nome e cor de cada personagem no HUD
        [this.p1, this.p2].forEach(p => {
            const el = document.getElementById(`${p.slot}-hud-name`);
            el.innerText = this.nameOf(p) + (p.cpu ? ' 🤖' : '');
            el.style.color = CHARACTERS[p.char].hud;
        });

        this.paused = false;
        this.isRunning = true;
        this.lastTime = null;
        this.acc = 0;
        this.setPlayState();
        this.updateHUD();
        playSfx('start');
        this.rafId = requestAnimationFrame(t => this.gameLoop(t));
    }

    // cria as 3 nuvens do próximo nível, na altura exata da próxima plataforma
    generateLevelClouds(player) {
        player.currentQuestion = this.newQuestionFor(player);
        player.clouds = [];

        const cloudY = levelTop(player.level + 1);
        const positionsX = [48, 190, 332];

        player.currentQuestion.options.forEach((value, i) => {
            player.clouds.push({
                x: positionsX[i], y: cloudY, w: 100, h: 40,
                value,
                isCorrect: value === player.currentQuestion.answer,
                wrongHit: false,
                alpha: 1
            });
        });
    }

    addFloat(p, text, color) {
        p.floats.push({ text, color, x: p.x + p.w / 2, y: p.y - 6, life: 60 });
    }

    // input = { left, right, jump }; locked = true durante o fatality: sem controle e sem nuvens
    updatePlayer(p, input, locked) {
        /* ---- depois de um erro: mostra a conta certa e depois troca a pergunta ---- */
        if (p.reveal > 0) {
            p.reveal--;
            if (p.reveal === 0) this.generateLevelClouds(p);
        }

        /* ---- movimento horizontal ---- */
        if (locked) p.vx = 0;
        else if (input.left) { p.vx = -CONFIG.SPEED; p.facingRight = false; }
        else if (input.right) { p.vx = CONFIG.SPEED; p.facingRight = true; }
        else p.vx = 0;

        /* ---- pulo (só quando está apoiado) ---- */
        if (!locked && input.jump && p.onGround) {
            p.vy = CONFIG.JUMP;
            p.onGround = false;
        }

        /* ---- física ---- */
        p.prevY = p.y;
        p.vy += CONFIG.GRAVITY;
        p.x += p.vx;
        p.y += p.vy;

        // limites laterais = bordas da montanha
        if (p.x < CONFIG.WALL_L) p.x = CONFIG.WALL_L;
        if (p.x + p.w > CONFIG.WALL_R) p.x = CONFIG.WALL_R - p.w;

        p.onGround = false;

        /* ---- colisão com as nuvens (plataformas de mão única: só pousa caindo) ---- */
        if (!locked && p.reveal === 0 && p.vy > 0) {
            const feet = p.y + p.h;
            const prevFeet = p.prevY + p.h;
            // hitbox dos pés (mais estreita que o sprite)
            const footL = p.x + CONFIG.HIT_INSET;
            const footR = p.x + p.w - CONFIG.HIT_INSET;

            for (const cloud of p.clouds) {
                if (cloud.wrongHit) continue;

                const crossedTop = prevFeet <= cloud.y + 1 && feet >= cloud.y;
                const overlapsX = footR > cloud.x + 6 && footL < cloud.x + cloud.w - 6;
                if (!(crossedTop && overlapsX)) continue;

                if (cloud.isCorrect) {
                    // pousa na nuvem certa e sobe de nível
                    p.y = cloud.y - p.h;
                    p.vy = 0;
                    p.onGround = true;
                    p.level++;
                    p.stats.right++;
                    this.addFloat(p, '+1', '#FFD700');
                    this.generateLevelClouds(p);
                } else {
                    // nuvem errada: perde vida, o jogador cai e o jogo mostra a resposta certa
                    const q = p.currentQuestion;
                    cloud.wrongHit = true;
                    p.clouds.forEach(c => {
                        if (c.isCorrect) c.reveal = true;
                        else if (c !== cloud) c.dim = true;
                    });
                    p.reveal = CONFIG.REVEAL_FRAMES;
                    p.lives--;
                    p.lastWrong = cloud.value;
                    p.stats.wrong++;
                    p.stats.mistakes.push({ text: q.questionText, answer: q.answer, chosen: cloud.value });
                    p.vy = -6;
                    this.addFloat(p, '-1 ❤', '#FF4444');
                    if (p.lives <= 0) {
                        const other = p === this.p1 ? this.p2 : this.p1;
                        this.endGame(this.nameOf(other), `${this.nameOf(p)} perdeu todas as vidas!`);
                        return;
                    }
                }
                break;
            }
        }

        /* ---- plataforma do nível atual (chão do jogador) ---- */
        const ledge = levelTop(p.level);
        if (p.vy >= 0 && p.y + p.h >= ledge) {
            p.y = ledge - p.h;
            p.vy = 0;
            p.onGround = true;
        }

        /* ---- nuvens erradas desaparecem aos poucos (a certa fica, verde) ---- */
        p.clouds.forEach(c => { if (c.wrongHit || c.dim) c.alpha = Math.max(0, c.alpha - 0.04); });

        /* ---- textos flutuantes ---- */
        p.floats.forEach(f => { f.y -= 0.8; f.life--; });
        p.floats = p.floats.filter(f => f.life > 0);

        /* ---- câmera suave ---- */
        const target = p.level * CONFIG.LEVEL_H;
        p.cameraY += (target - p.cameraY) * 0.12;
        if (Math.abs(target - p.cameraY) < 0.5) p.cameraY = target;
    }

    checkWinConditions() {
        const diff = this.p1.level - this.p2.level;
        if (diff >= CONFIG.LEAD_TO_WIN) this.beginFatality(this.p1, this.p2);
        else if (-diff >= CONFIG.LEAD_TO_WIN) this.beginFatality(this.p2, this.p1);
    }

    /* ---------------- FATALITY ---------------- */
    beginFatality(winner, loser) {
        // peso da bigorna = resultado errado do perdedor (ou o resultado que ele não alcançou)
        const weight = loser.lastWrong != null ? loser.lastWrong : loser.currentQuestion.answer;
        this.fatality = {
            winner, loser, weight,
            phase: 'book',
            t: 0,
            timer: CONFIG.FATALITY_TIME * 60,
            prog: FATALITIES.map(() => 0),
            opt: null
        };
        this.setPlayState();
        this.renderBook();
        document.getElementById('fatality-book').classList.remove('hidden');
        playSfx('name');
    }

    renderBook() {
        const f = this.fatality;
        const slot = f.winner.slot;
        const who = document.getElementById('book-who');
        who.className = 'book-who ' + slot;
        who.innerHTML = f.winner.cpu
            ? `${this.nameOf(f.winner)} (computador) abriu 5 níveis de vantagem!<br>O computador está escolhendo um golpe...`
            : `${this.nameOf(f.winner)} abriu 5 níveis de vantagem!<br>Digite uma sequência para finalizar o adversário:`;

        const entry = (fat, i) => `
            <div class="book-entry" data-i="${i}">
                <div class="entry-num">${i + 1}</div>
                <div class="entry-body">
                    <div class="entry-title">${fat.title}</div>
                    <div class="entry-desc">${fat.desc}</div>
                    <div class="entry-keys">${fat.seq.map(d => `<span class="key">${KEY_LABEL[slot][d]}</span>`).join('')}</div>
                </div>
            </div>`;
        document.getElementById('book-col-left').innerHTML = FATALITIES.slice(0, 3).map((x, i) => entry(x, i)).join('');
        document.getElementById('book-col-right').innerHTML = FATALITIES.slice(3).map((x, i) => entry(x, i + 3)).join('');
        document.getElementById('book-time').innerText = CONFIG.FATALITY_TIME;
        document.getElementById('book-bar-fill').style.width = '100%';
        this.updateBookUI();
    }

    updateBookUI() {
        const f = this.fatality;
        document.querySelectorAll('.book-entry').forEach(el => {
            const i = Number(el.dataset.i);
            el.classList.toggle('active', f.prog[i] > 0);
            el.querySelectorAll('.key').forEach((k, idx) => k.classList.toggle('on', idx < f.prog[i]));
        });
    }

    onFatalityKey(e) {
        const f = this.fatality;
        if (!f || f.phase !== 'book' || e.repeat || f.winner.cpu || this.paused) return;
        const d = DIR_KEYS[f.winner.slot][e.code];
        if (d) this.fatalityInput(d);
    }

    // uma direção digitada no livro (pelo teclado ou pelas setas da tela)
    fatalityInput(d) {
        const f = this.fatality;
        if (!f || f.phase !== 'book') return;

        let any = false;
        f.prog = f.prog.map((p, i) => {
            const seq = FATALITIES[i].seq;
            const np = seq[p] === d ? p + 1 : (seq[0] === d ? 1 : 0);
            if (np > 0) any = true;
            return np;
        });
        this.updateBookUI();

        const done = f.prog.findIndex((p, i) => p >= FATALITIES[i].seq.length);
        if (done >= 0) { this.chooseFatality(done); return; }

        if (any) playSfx('key');
        else {
            playSfx('wrong');
            const book = document.getElementById('book');
            book.classList.remove('shake');
            void book.offsetWidth;            // reinicia a animação
            book.classList.add('shake');
        }
    }

    chooseFatality(i) {
        const f = this.fatality;
        f.opt = i;
        f.phase = 'cutscene';
        f.t = 0;
        document.getElementById('fatality-book').classList.add('hidden');

        // os dois vão para o meio do chão do próprio nível, com a câmera já assentada
        [f.loser, f.winner].forEach(p => {
            p.x = (CONFIG.WIDTH - CONFIG.PLAYER_W) / 2;
            p.y = levelTop(p.level) - p.h;
            p.vy = 0; p.vx = 0;
            p.onGround = true;
            p.cameraY = p.level * CONFIG.LEVEL_H;
            p.floats = [];
        });
        f.winner.facingRight = f.winner === this.p1;   // olhando para a tela do adversário
    }

    updateFatality() {
        const f = this.fatality;
        if (f.phase === 'book') {
            // os dois só assentam no chão enquanto o vencedor escolhe
            this.updatePlayer(this.p1, null, true);
            this.updatePlayer(this.p2, null, true);
            // o computador "digita" a sequência de um golpe sorteado, uma tecla por vez
            if (f.winner.cpu) {
                if (f.cpuPick == null) f.cpuPick = rnd(0, FATALITIES.length - 1);
                f.cpuT = (f.cpuT || 0) + 1;
                if (f.cpuT > 70 && f.cpuT % 16 === 0) {
                    this.fatalityInput(FATALITIES[f.cpuPick].seq[f.prog[f.cpuPick]]);
                    if (f.phase !== 'book') return;
                }
            }
            f.timer--;
            if (f.timer % 6 === 0) {
                document.getElementById('book-time').innerText = Math.max(0, Math.ceil(f.timer / 60));
                document.getElementById('book-bar-fill').style.width = (100 * f.timer / (CONFIG.FATALITY_TIME * 60)) + '%';
            }
            if (f.timer <= 0) this.chooseFatality(rnd(0, FATALITIES.length - 1));   // tempo esgotou: sorteia
        } else if (f.phase === 'cutscene') {
            f.t++;
            const fat = FATALITIES[f.opt];
            if (fat.sfx[f.t]) playSfx(fat.sfx[f.t]);
            if (f.t >= fat.dur) {
                f.phase = 'name';
                f.t = 0;
                document.getElementById('fatality-title').innerText = fat.name;
                document.getElementById('fatality-name').classList.remove('hidden');
                playSfx('name');
            }
        } else if (f.phase === 'name') {
            f.t++;
            if (f.t >= CONFIG.NAME_FRAMES) {
                const fat = FATALITIES[f.opt];
                this.endGame(this.nameOf(f.winner), `FATALITY: ${fat.name}`);
            }
        }
    }

    hideFatalityUI() {
        document.getElementById('fatality-book').classList.add('hidden');
        document.getElementById('fatality-name').classList.add('hidden');
    }

    endGame(winnerName, reason) {
        if (!this.isRunning) return;
        this.isRunning = false;
        this.setPlayState();
        this.hideFatalityUI();
        document.getElementById('winner-title').innerText = `${winnerName} VENCEU!`;
        document.getElementById('winner-reason').innerText = reason;
        this.renderStats();
        this.showScreen('game-over-screen');
    }

    // resumo de cada jogador: acertos, erros, aproveitamento e as contas que errou (com a resposta certa)
    renderStats() {
        const card = p => {
            const s = p.stats;
            const total = s.right + s.wrong;
            const pct = total ? Math.round(100 * s.right / total) : 0;
            const review = s.mistakes.slice(-3).map(m =>
                `<p>${m.text} = <b>${m.answer}</b> <s>${m.chosen}</s></p>`).join('');
            return `
                <div class="stat-card ${p.slot}">
                    <h3>${this.nameOf(p)}${p.cpu ? ' 🤖' : ''}</h3>
                    <p class="stat-line stat-good">✔ Acertos: <b>${s.right}</b></p>
                    <p class="stat-line stat-bad">✘ Erros: <b>${s.wrong}</b></p>
                    <p class="stat-line">🎯 Aproveitamento: <b>${pct}%</b></p>
                    <div class="review">
                        ${s.mistakes.length
                            ? `<p class="review-title">PARA REVISAR:</p>${review}`
                            : '<p class="review-title">NENHUM ERRO! 🌟</p>'}
                    </div>
                </div>`;
        };
        document.getElementById('stats').innerHTML = card(this.p1) + card(this.p2);
    }

    updateHUD() {
        const hearts = n => '❤'.repeat(Math.max(0, n));
        [this.p1, this.p2].forEach(p => {
            document.getElementById(`${p.slot}-lvl`).innerText = `Nível: ${p.level}`;
            document.getElementById(`${p.slot}-lives`).innerText = hearts(p.lives);
        });
    }

    /* ---------------- DESENHO ---------------- */
    // céu em faixas (estilo pixel) de acordo com a luz escolhida
    drawSky(ctx) {
        const L = LIGHTS[this.settings.light] || LIGHTS.dia;
        if (!L.bands) {
            L.bands = [];
            for (let i = 0; i < 12; i++) L.bands.push(mixHex(L.sky[0], L.sky[1], i / 11));
        }
        const bh = this.height / L.bands.length;
        L.bands.forEach((c, i) => {
            ctx.fillStyle = c;
            ctx.fillRect(0, Math.floor(i * bh), this.width, Math.ceil(bh) + 1);
        });
        if (L.stars) {
            for (let i = 0; i < 40; i++) {
                if ((this.frame + i * 23) % 120 < 12) continue;   // estrelas piscando
                ctx.fillStyle = i % 5 === 0 ? '#FFE680' : '#FFFFFF';
                ctx.fillRect(Math.floor(prand(i) * this.width), Math.floor(prand(i + 50) * this.height), 2, 2);
            }
        }
    }

    renderViewport(ctx, player) {
        const W = this.width, H = this.height;
        const cam = player.cameraY;
        const f = this.fatality;
        const inCut = !!f && (f.phase === 'cutscene' || f.phase === 'name');
        const fat = inCut ? FATALITIES[f.opt] : null;
        const sceneT = inCut ? (f.phase === 'cutscene' ? f.t : fat.dur) : 0;
        const loserView = inCut && f.loser === player;
        const winnerView = inCut && f.winner === player && !!fat.winnerDraw;
        const light = LIGHTS[this.settings.light] || LIGHTS.dia;

        ctx.clearRect(0, 0, W, H);
        this.drawSky(ctx);

        ctx.save();
        if (loserView) {                                 // tremor da tela do perdedor
            const amp = fat.shake(sceneT, f);
            ctx.translate(Math.sin(sceneT * 7.3) * amp, Math.cos(sceneT * 9.1) * amp);
        }

        ctx.save();
        ctx.translate(0, Math.round(cam));               // tela = mundo + cam

        /* montanha (tijolos) */
        const topWorld = -Math.round(cam) - 32;
        const startY = Math.floor(topWorld / 32) * 32;
        const endY = -Math.round(cam) + H + 32;
        for (let y = startY; y < endY; y += 32) {
            for (let x = CONFIG.WALL_L; x < CONFIG.WALL_R; x += 32) {
                ctx.drawImage(tilePatternCanvas, x, y);
            }
        }
        // "iluminação" da montanha (dia, pôr do sol ou noite)
        ctx.fillStyle = light.shade;
        ctx.fillRect(CONFIG.WALL_L, startY, CONFIG.WALL_R - CONFIG.WALL_L, endY - startY);

        /* plataformas dos níveis já alcançados */
        for (let k = Math.max(0, player.level - 4); k <= player.level; k++) drawLedge(ctx, k);

        /* nuvens */
        player.clouds.forEach(c => { if (c.alpha > 0) drawPixelCloud(ctx, c); });

        /* personagem (nas cenas de fatality ele pode ser desenhado pela própria cena) */
        if (!loserView && !winnerView) {
            drawPixelCharacter(ctx, player.x, player.y, player.char, player.facingRight, !player.onGround);
        }

        /* textos flutuantes */
        ctx.font = '12px "Press Start 2P", monospace';
        ctx.textAlign = 'center';
        player.floats.forEach(fl => {
            ctx.globalAlpha = Math.min(1, fl.life / 20);
            ctx.fillStyle = '#000';
            ctx.fillText(fl.text, fl.x + 1, fl.y + 1);
            ctx.fillStyle = fl.color;
            ctx.fillText(fl.text, fl.x, fl.y);
        });
        ctx.globalAlpha = 1;

        ctx.restore();

        /* cenas do fatality (coordenadas da tela: o chão fica em y = 520) */
        if (loserView) fat.draw(this, ctx, f, sceneT);
        if (winnerView) fat.winnerDraw(this, ctx, f, sceneT);

        /* pergunta no topo da tela (some durante as cenas) */
        if (!inCut) {
            const q = player.currentQuestion;
            const showing = player.reveal > 0;          // depois de um erro: mostra a conta resolvida
            ctx.save();
            ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
            ctx.fillRect(20, 64, W - 40, 48);
            ctx.strokeStyle = showing ? '#FF4444' : '#FFD700';
            ctx.lineWidth = 3;
            ctx.strokeRect(20, 64, W - 40, 48);
            ctx.font = '13px "Press Start 2P", monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            if (showing) {
                ctx.fillStyle = '#7CFC7C';
                ctx.fillText(`${q.questionText} = ${q.answer}`, W / 2, 89);
                ctx.fillStyle = 'rgba(139, 0, 0, 0.9)';
                ctx.fillRect(W / 2 - 150, 114, 300, 22);
                ctx.font = '9px "Press Start 2P", monospace';
                ctx.fillStyle = '#FFF';
                ctx.fillText('ERROU! ESSA É A CONTA CERTA', W / 2, 126);
            } else {
                ctx.fillStyle = '#FFF';
                ctx.fillText(`${q.questionText} = ?`, W / 2, 89);
            }
            ctx.restore();
        }

        ctx.restore();
    }

    update() {
        this.frame++;
        if (this.fatality) { this.updateFatality(); return; }
        this.updatePlayer(this.p1, this.readInput(this.p1), false);
        if (!this.isRunning) return;
        this.updatePlayer(this.p2, this.readInput(this.p2), false);
        if (!this.isRunning) return;
        this.checkWinConditions();
    }

    gameLoop(timestamp) {
        if (this.lastTime === null) this.lastTime = timestamp;
        if (!this.paused) this.acc += Math.min(timestamp - this.lastTime, 100);   // pausado: o tempo não anda
        this.lastTime = timestamp;

        // passo fixo: o jogo roda igual em monitores de 60Hz, 144Hz etc.
        while (this.acc >= CONFIG.STEP && this.isRunning && !this.paused) {
            this.update();
            this.acc -= CONFIG.STEP;
        }

        this.updateHUD();
        this.renderViewport(this.ctxP1, this.p1);
        this.renderViewport(this.ctxP2, this.p2);

        if (this.isRunning) {
            this.rafId = requestAnimationFrame(t => this.gameLoop(t));
        }
    }
}

/* =====================================================
   INICIALIZAÇÃO
   ===================================================== */
// Mostra qualquer erro de JavaScript na própria tela (ajuda a descobrir problemas)
function showErrorBanner(msg) {
    let bar = document.getElementById('error-banner');
    if (!bar) {
        bar = document.createElement('div');
        bar.id = 'error-banner';
        bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:999;background:#8B0000;' +
            'color:#FFF;font:12px monospace;padding:8px 12px;';
        document.body.appendChild(bar);
    }
    bar.textContent = 'Erro no jogo: ' + msg;
}
window.addEventListener('error', e => showErrorBanner(e.message));

function initGame() {
    if (window.gameInstance) return;
    try {
        window.gameInstance = new MathClimbGame();
    } catch (err) {
        console.error(err);
        const box = document.getElementById('start-screen');
        if (box) box.insertAdjacentHTML('beforeend',
            `<p style="color:#FF6666;font-size:10px;margin-top:16px">Erro ao iniciar: ${err.message}</p>`);
    }
}

// funciona tanto se o script rodar antes quanto depois do carregamento da página
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initGame);
} else {
    initGame();
}
