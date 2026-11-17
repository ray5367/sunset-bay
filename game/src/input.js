// input.js — keyboard and mouse state with edge-triggered presses.
// The game loop reads isDown() for held keys and wasPressed() for single
// actions, then calls endFrame() so a press fires exactly once.

const GAME_KEYS = new Set([
  'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE', 'KeyF', 'KeyR', 'KeyM',
  'KeyP', 'KeyH', 'KeyC', 'Digit1', 'Digit2', 'Digit3', 'Digit4',
  'Escape', 'Enter', 'ShiftLeft', 'ShiftRight',
]);

export class Input {
  constructor() {
    this.down = new Set();
    this.pressed = new Set();
    this.mouse = { x: 0, y: 0, down: false, clicked: false, rightDown: false };
    this.anyKey = false;
  }

  attach(target, canvas) {
    target.addEventListener('keydown', (event) => {
      if (GAME_KEYS.has(event.code)) event.preventDefault();
      if (!event.repeat) {
        this.pressed.add(event.code);
        this.anyKey = true;
      }
      this.down.add(event.code);
    });
    target.addEventListener('keyup', (event) => {
      this.down.delete(event.code);
    });
    target.addEventListener('blur', () => {
      this.down.clear();
      this.mouse.down = false;
    });
    canvas.addEventListener('mousemove', (event) => {
      this.mouse.x = event.clientX;
      this.mouse.y = event.clientY;
    });
    canvas.addEventListener('mousedown', (event) => {
      if (event.button === 0) {
        this.mouse.down = true;
        this.mouse.clicked = true;
      } else if (event.button === 2) {
        this.mouse.rightDown = true;
      }
    });
    target.addEventListener('mouseup', (event) => {
      if (event.button === 0) this.mouse.down = false;
      if (event.button === 2) this.mouse.rightDown = false;
    });
    canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  isDown(code) {
    return this.down.has(code);
  }

  wasPressed(code) {
    return this.pressed.has(code);
  }

  // -1..1 movement axes from WASD/arrows.
  moveX() {
    return (this.isDown('KeyD') || this.isDown('ArrowRight') ? 1 : 0)
      - (this.isDown('KeyA') || this.isDown('ArrowLeft') ? 1 : 0);
  }

  moveY() {
    return (this.isDown('KeyS') || this.isDown('ArrowDown') ? 1 : 0)
      - (this.isDown('KeyW') || this.isDown('ArrowUp') ? 1 : 0);
  }

  get running() {
    return this.isDown('ShiftLeft') || this.isDown('ShiftRight');
  }

  endFrame() {
    this.pressed.clear();
    this.mouse.clicked = false;
    this.anyKey = false;
  }
}
