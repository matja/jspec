/*

references:
1: Z80 Family CPU User Manual - Zilog
   http://www.zilog.com/docs/z80/um0080.pdf
3: Z80 Flag Affection
   http://www.z80.info/z80sflag.htm
4:
   http://www.z80.info/z80undoc3.txt

48k ROM:
	EI locations:
		0051
		03F6
		054F
		0EDE
		1234

	breakpoints
		196c print decoded input keyword
		0c4c found keyword in table

	checkpoints
		638998 RAM-DONE
		639245 RAM-SET : DEC (IY-$3A) ; KSTATE-0
		639264 SET 1,(IY+$01) ; FLAGS
		647681 CL-LINE-3 : POP BC

	first IRQ with IFF1=1 at 641596 steps

	BUG: 689429 ticks : 128E FD 36 31 02 LD (IY+$31),$02 -> wrote $31
	BUG: A=FD : ADD A,A ; ADD A,16 -> parity?S
	BUG: 689469 ticks : 16E0 : C flag should be 0 after CP C (A=4B, C=4B)
	BUG: 689538 ticks : 0DEC : SUB $18 (A=19)
	0d63: what is this routine?
	BUG: after pressing Q for "PLOT", BC value at PO-ST-E (0AF0) continues decrementing past 1720


z80tests.sna:
0x8935 start of test
0x8954 end of test
0x8963 compare result


buggy instructions :
ld r,a

add hl,hl (hl=0x0f10)-> f becomes b8 should be 98
bit 0,(iy+2) (0x00) -> f becomes 0x55 0101 0101 should be 0x5d 0101 1101
and n -> disasm
adc a,0 (a=0xff) -> f becomes 0x01 should be 0x51


ld a,0x10 ; rst 0x10 ; break at 2215 -> fuse differs
*/

var g_test_rom = false;
var g_break = 0;
var g_breakpoint = 0;
var g_fuzz_log = "";
var g_fuzz_log_enable = true;

var my_seed = 0;
var boost_cb = 0;

function u2s8(x)
{
	if (x > 127) return -256 + x;
	return x;
}

function my_rand()
{
	var i = 0;
	my_seed = ((my_seed * 0x343fd) + 0x269ec3) & 0xffffffff;
	my_seed ^= ((my_seed << 5) & 0xffffffff);

	if (boost_cb && (((my_seed >> 16) & 3) == 0)) {
		i = 0xcb;
		boost_cb = 0;
	} else {
		switch ((my_seed >> 16) & 0x1f) {
			case 0 : i = 0xcb; break;
			case 1 : i = 0xdd; boost_cb = 1; break;
			case 2 : i = 0xfd; boost_cb = 1; break;
			case 3 : i = 0xed; break;
			default : i = my_seed & 0xff; break;
		}
	}

	if (i == 0x76) { i = 0; }
	return i;
}

function fuzzLog(s)
{
	if (g_fuzz_log_enable) {
		g_fuzz_log += s;
	}
}

function stringPadLeft(s, n)
{
	while (s.length < n) {
		s = ' ' + s;
	}
	return s;
}

function stringPadRight(s, n)
{
	while (s.length < n) {
		s = s + ' ';
	}
	return s;
}

function str_repeat(i, m) {
	for (var o = []; m > 0; o[--m] = i);
	return o.join('');
}

function sprintf() {
	var sf = "sprintf: ";
	var i = 0, a, f = arguments[i++], o = [], m, p, c, x, s = '';
	while (f) {
		if (m = /^[^\x25]+/.exec(f)) {
			o.push(m[0]);
		}
		else if (m = /^\x25{2}/.exec(f)) {
			o.push('%');
		}
		else if (m = /^\x25(?:(\d+)\$)?(\+)?(0|'[^$])?(-)?(\d+)?(?:\.(\d+))?([b-fosuxX])/.exec(f)) {
			if (((a = arguments[m[1] || i++]) == null) || (a == undefined)) {
				throw(sf + 'Too few arguments.');
			}
			if (/[^s]/.test(m[7]) && (typeof(a) != 'number')) {
				throw(sf + 'Expecting number but found ' + typeof(a));
			}
			switch (m[7]) {
				case 'b': a = a.toString(2); break;
				case 'c': a = String.fromCharCode(a); break;
				case 'd': a = parseInt(a); break;
				case 'e': a = m[6] ? a.toExponential(m[6]) : a.toExponential(); break;
				case 'f': a = m[6] ? parseFloat(a).toFixed(m[6]) : parseFloat(a); break;
				case 'o': a = a.toString(8); break;
				case 's': a = ((a = String(a)) && m[6] ? a.substring(0, m[6]) : a); break;
				case 'u': a = Math.abs(a); break;
				case 'x': a = a.toString(16); break;
				case 'X': a = a.toString(16).toUpperCase(); break;
			}
			a = (/[def]/.test(m[7]) && m[2] && a >= 0 ? '+'+ a : a);
			c = m[3] ? m[3] == '0' ? '0' : m[3].charAt(1) : ' ';
			x = m[5] - String(a).length - s.length;
			p = m[5] ? str_repeat(c, x) : '';
			o.push(s + (m[4] ? a + p : p + a));
		}
		else {
			throw(sf + 'invalid format');
		}
		f = f.substring(m[0].length);
	}
	return o.join('');
}

var domLoaded = function (callback) {
    /* Internet Explorer */
    /*@cc_on
    @if (@_win32 || @_win64)
        document.write('<script id="ieScriptLoad" defer src="//:"><\/script>');
        document.readElementById('ieScriptLoad').onreadystatechange = function() {
            if (this.readyState == 'complete') {
                callback();
            }
        };
		return;
    @end @*/
    if (document.addEventListener) {
		/* Mozilla, Chrome, Opera */
        document.addEventListener('DOMContentLoaded', callback, false);
    } else if (/KHTML|WebKit|iCab/i.test(navigator.userAgent)) {
		/* Safari, iCab, Konqueror */
        var DOMLoadTimer = writeInterval(function () {
            if (/loaded|complete/i.test(document.readyState)) {
                callback();
                clearInterval(DOMLoadTimer);
            }
        }, 10);
    } else {
		/* Other web browsers */
		window.onload = callback;
	}
};

var SpectrumMemory = function() {
	var self = this;

	self.debug = 1;
	self.rom = new Uint8Array(16*1024);
	self.ram = new Uint8Array(48*1024);

	for (var i=0; i < self.rom.length; i++) {
		self.rom[i] = 0;
	}

	for (var i=0; i < self.ram.length; i++) {
		self.ram[i] = i;
	}

	if (g_test_rom) {
		// setup test ROM
		var d = [
			0x3e,0x32,
		];

		for (var i = 0; i < d.length; i++) {
			self.rom[i] = d[i];
		}
	} else {
		// load ROM file
		$.ajax({
			url: 'rom/48.rom'
			,async: false
			,responseType: 'arraybuffer'
			,mimeType: 'text/plain; charset=x-user-defined'
			,success: function(response) {
				for (var i=0; i < response.length; i++) {
					var x = response.charCodeAt(i) & 0xff;
					self.rom[i] = x;
				}
			}
		});
	}

	return self;
};

var SpectrumIO = function() {
	return this;
};

SpectrumIO.prototype = {
	read: function(address) {
		for (var kpi in this.machine.keyboard_ports) {
			var kp = this.machine.keyboard_ports[kpi];
			if (kp.port == address) {
				return kp.state;
			}
		}

		return 0xff;
	}
	,write: function(address, value) {
		if (address == 0xfe) {
			this.machine.setBorder(value & 0x7);
		}
	}
};

var FuzzRandomMemory = function() {
	return this;
};

var FuzzRandomIO = function() {
	return this;
};

FuzzRandomMemory.prototype = {
	read8: function(address) {
		var masked_address = address & 0xffff;
		var value = my_rand();

		fuzzLog(
			sprintf(
				"mread %04x %02x\n"
				,masked_address
				,value
			)
		);

		return value;
	}
	,sread8: function(address) {
		return 0;
	}
	,write8: function(address, value) {
		var masked_address = address & 0xffff;

		fuzzLog(
			sprintf(
				"mwrite %04x %02x\n"
				,masked_address
				,value
			)
		);
	}
	,swrite8: function(address, value) { }
	,read16: function(address) {
		return this.read8(address) | (this.read8(address + 1) << 8);
	}
	,write16: function(address, value) {
		this.write8(address, value & 0xff);
		this.write8(address+1, value >> 8);
	}
	,sread16: function(address) {
		return this.sread8(address) | (this.sread8(address + 1) << 8);
	}
	,swrite16: function(address, value) {
		this.swrite8(address, value & 0xff);
		this.swrite8(address+1, value >> 8);
	}
};

FuzzRandomIO.prototype = {
	read: function(address) {
		var masked_address = address & 0xffff;
		var value = my_rand();

		fuzzLog(
			sprintf(
				"ioread %04x %02x\n"
				,masked_address
				,value
			)
		);

		return value;
	}
	,write: function(address, value) {
		var masked_address = address & 0xffff;

		fuzzLog(
			sprintf(
				"iowrite %04x %02x\n"
				,masked_address
				,value
			)
		);
	}
};

var FuzzMemory = function() {
	var self = this;

	self.rom = new Uint8Array(16*1024);
	self.ram = new Uint8Array(48*1024);

	for (var i=0; i < self.rom.length; i++) {
		self.rom[i] = 0;
	}

	for (var i=0; i < self.ram.length; i++) {
		self.ram[i] = i;
	}

	// load ROM file
	$.ajax({
		url: 'rom/48.rom'
		,async: false
		,responseType: 'arraybuffer'
		,mimeType: 'text/plain; charset=x-user-defined'
		,success: function(response) {
			for (var i=0; i < response.length; i++) {
				var x = response.charCodeAt(i) & 0xff;
				self.rom[i] = x;
			}
		}
	});

	return this;
};

var FuzzIO = function() {
	return this;
};

FuzzMemory.prototype = {
	read8: function(address) {
		var masked_address = address & 0xffff;
		var value = 0xff;
		if (masked_address < 0x4000) {
			value = this.rom[masked_address];
		} else {
			value = this.ram[masked_address - 0x4000];
		}
		fuzzLog(
			sprintf(
				"mread %04x %02x\n"
				,masked_address
				,value
			)
		);
		return value;
	}
	,sread8: function(address) {
		/* silent read - for debugging only, don't affect hardware */
		var masked_address = address & 0xffff;
		var value = 0xff;
		if (masked_address < 0x4000) {
			value = this.rom[masked_address];
		} else {
			value = this.ram[masked_address - 0x4000];
		}

		return value;
	}
	,write8: function(address, value) {
		var masked_address = address & 0xffff;
		if (masked_address < 0x4000) {
			//console.error("SpectrumMemory.write8: attempt to write to ROM at " + masked_address);
		}
		this.ram[masked_address - 0x4000] = value & 0xff;
		fuzzLog(
			sprintf(
				"mwrite %04x %02x\n"
				,masked_address
				,value
			)
		);
	}
	,swrite8: function(address, value) {
		/* silent write - for debugging only, don't affect hardware */
		var masked_address = address & 0xffff;
		if (masked_address < 0x4000) {
			//console.error("SpectrumMemory.write8: attempt to write to ROM at " + masked_address);
		}
		this.ram[masked_address - 0x4000] = value & 0xff;
	}
	,read16: function(address) {
		return this.read8(address) | (this.read8(address + 1) << 8);
	}
	,write16: function(address, value) {
		this.write8(address, value & 0xff);
		this.write8(address+1, value >> 8);
	}
	,sread16: function(address) {
		return this.sread8(address) | (this.sread8(address + 1) << 8);
	}
	,swrite16: function(address, value) {
		this.swrite8(address, value & 0xff);
		this.swrite8(address+1, value >> 8);
	}
};

FuzzIO.prototype = {
	read: function(address) {
		var masked_address = address & 0xffff;
		var value = 0xff;

		fuzzLog(
			sprintf(
				"ioread %04x %02x\n"
				,masked_address
				,value
			)
		);

		return value;
	}
	,write: function(address, value) {
		var masked_address = address & 0xffff;

		fuzzLog(
			sprintf(
				"iowrite %04x %02x\n"
				,masked_address
				,value
			)
		);
	}
};

SpectrumMemory.prototype = {
	read8: function(address) {
		var masked_address = address & 0xffff;
		var value = 0xff;
		if (masked_address < 0x4000) {
			value = this.rom[masked_address];
		} else {
			value = this.ram[masked_address - 0x4000];
		}
		if (this.debug) {
			console.log(
				sprintf(
					"SpectrumMemory: read8(%04X) = %02X"
					,masked_address
					,value
				)
			);
		}
		return value;
	}
	,sread8: function(address) {
		/* silent read - for debugging only, don't affect hardware */
		var masked_address = address & 0xffff;
		var value = 0xff;
		if (masked_address < 0x4000) {
			value = this.rom[masked_address];
		} else {
			value = this.ram[masked_address - 0x4000];
		}

		return value;
	}
	,write8: function(address, value) {
		var masked_address = address & 0xffff;
		if (masked_address < 0x4000) {
			//console.error("SpectrumMemory.write8: attempt to write to ROM at " + masked_address);
		}
		this.ram[masked_address - 0x4000] = value & 0xff;
		if (this.debug) {
			console.log(
				sprintf(
					"SpectrumMemory: write8(%04X) = %02X"
					,masked_address
					,value
				)
			);
		}
	}
	,swrite8: function(address, value) {
		/* silent write - for debugging only, don't affect hardware */
		var masked_address = address & 0xffff;
		if (masked_address < 0x4000) {
			//console.error("SpectrumMemory.write8: attempt to write to ROM at " + masked_address);
		}
		this.ram[masked_address - 0x4000] = value & 0xff;
	}
	,read16: function(address) {
		return this.read8(address) | (this.read8(address + 1) << 8);
	}
	,write16: function(address, value) {
		this.write8(address, value & 0xff);
		this.write8(address+1, value >> 8);
	}
	,sread16: function(address) {
		return this.sread8(address) | (this.sread8(address + 1) << 8);
	}
	,swrite16: function(address, value) {
		this.swrite8(address, value & 0xff);
		this.swrite8(address+1, value >> 8);
	}
};

var Spectrum = function() {
	var self = this;
	var i=0, j=0;

	/* create hardware */
	self.memory = new SpectrumMemory();
	self.io = new SpectrumIO();
	self.io.machine = self;

	self.cpu = new Z80();
	self.cpu.create();
	self.cpu.machine = self;
	self.cpu.mmu = this.memory;
	self.cpu.io = this.io;
	self.cpu.mmu.machine = self;
	self.cpu.io.machine = self;
	self.cpu.status();

	self.ula = {
		border: 0
		,colours: []
	};
	self.frames = 0;
	self.border_left = 48;
	self.border_right = 48;
	self.border_top = 48;
	self.border_bottom = 56;

	self.ula.border_line = new Uint8Array(512);
	for (i=0; i < this.ula.border_line.length; i++) {
		this.ula.border_line[i] = 7;
	}
	self.last_border_line_value = 0;
	self.last_border_line_y = 0;

	self.keyboard_ports = [
		{ port: 0x7ffe, state:0xff }
		,{ port: 0xbffe, state:0xff }
		,{ port: 0xdffe, state:0xff }
		,{ port: 0xeffe, state:0xff }
		,{ port: 0xf7fe, state:0xff }
		,{ port: 0xfbfe, state:0xff }
		,{ port: 0xfdfe, state:0xff }
		,{ port: 0xfefe, state:0xff }
	];

	var colours = [
		// normal
		[ 0x00, 0x00, 0x00, 0xff ], // black
		[ 0x00, 0x00, 0xb0, 0xff ], // blue
		[ 0xb0, 0x00, 0x00, 0xff ], // red
		[ 0xb0, 0x00, 0xb0, 0xff ], // magenta
		[ 0x00, 0xb0, 0x00, 0xff ], // green
		[ 0x00, 0xb0, 0xb0, 0xff ], // cyan
		[ 0xb0, 0xb0, 0x00, 0xff ], // yellow
		[ 0xb0, 0xb0, 0xb0, 0xff ], // white
		// bright
		[ 0x00, 0x00, 0x00, 0xff ], // black
		[ 0x00, 0x00, 0xf0, 0xff ], // blue
		[ 0xf0, 0x00, 0x00, 0xff ], // red
		[ 0xf0, 0x00, 0xf0, 0xff ], // magenta
		[ 0x00, 0xf0, 0x00, 0xff ], // green
		[ 0x00, 0xf0, 0xf0, 0xff ], // cyan
		[ 0xf0, 0xf0, 0x00, 0xff ], // yellow
		[ 0xf0, 0xf0, 0xf0, 0xff ], // white
	];

	for (var i=0; i < colours.length; i++) {
		this.ula.colours[i] = new Uint8Array(16);
		for (j=0; j < 4; j++) {
			this.ula.colours[i][j] = colours[i][j];
		}
	}

	g_jspec = self;
	return self;
}

Spectrum.prototype = {
	createUI: function(element_id) {
		var self = this;
		var e = document.getElementById(element_id);

/*
		var canvas = document.createElement('canvas');
		this.canvas = canvas;

		var width = 256+this.border_width*2;
		var height = 192+this.border_height*2;
		var scale = 1;

		canvas.writeAttribute('width', width);
		canvas.writeAttribute('height', height );
		canvas.writeAttribute('style', 'width:' + width*scale + 'px; height:' + height*scale + 'px;');
		e.appendChild(canvas);

*/
		this.canvas = document.getElementById("jspec-canvas");

		var button_run = document.getElementById('jspec-button-run');
		var button_step = document.getElementById('jspec-button-step');
		var button_stepn = document.getElementById('jspec-button-stepn');

		button_run.onclick = function() {
			button_run.setAttribute('disabled','true');
			self.setDebug(0);
			self.run();
		};

		button_step.onclick = function() {
			button_run.removeAttribute("disabled");
			self.setDebug(1);
			self.stepInstructions(1);
			self.setDebug(0);
			self.cpu.status();
			self.paint();
		};

		button_stepn.onclick = function() {
			button_run.removeAttribute("disabled");
			self.setDebug(0);
			self.stepInstructions($('#jspec-input-stepcount').val());
			self.cpu.status();
			self.paint();
		};

		var button = document.getElementById('jspec-button-reset');
		button.onclick = function() {
			self.reset();
		};

		var button = document.getElementById('jspec-button-load-rom');
		button.onclick = function() {
			self.loadROM($('#jspec-input-rom').val());
		};

		var button = document.getElementById('jspec-button-load-sna');
		button.onclick = function() {
			self.loadSNA($('#jspec-input-sna').val());
		};

		var button = document.getElementById('jspec-button-screenshot');
		button.onclick = function() {
			$('#jspec-upload-status').html('uploading...');
			$.ajax({
				url:"save.php",
				data:{
					data: document.getElementById('jspec-canvas').toDataURL()
				},
				type:"post",
				error: function(response) {
					$('#jspec-upload-status').html('failed');
				},
				success: function(response) {
					console.log(response);
					$('#jspec-upload-status').html('uploaded ' + response.length + ' bytes');
				}
			});
		}

		$('#jspec-button-fuzz').on('click', function(){
			var mode = $('#jspec-input-fuzz-mode').val();
			var seed = $('#jspec-input-fuzz-seed').val();
			var steps = $('#jspec-input-fuzz-steps').val();

			if (mode == 1) {
				self.memory = new FuzzMemory();
				self.io = new FuzzIO();
				self.cpu.mmu = self.memory;
				self.cpu.io = self.io;
			}


			self.cpu.fuzz(mode, seed, steps);
			self.cpu.mmu = new SpectrumMemory();
			self.cpu.io = new SpectrumIO();
		});

		document.onkeydown = function(e) {
			if (self.setKey(e.keyCode, 1)) {
				console.log(e.keyCode);
				e.preventDefault();
			}
		};

		document.onkeyup = function(e) {
			if (self.setKey(e.keyCode, 0)) {
				console.log(e.keyCode);
				e.preventDefault();
			}
		};
	}
	,setKey: function(keycode, down) {
		//console.log("setKey", keycode, down);

		// handle ZX Spectrum+ key combinations
		switch (keycode) {
			// DELETE
			case 8 : // backspace
				this.setKey(16, down); // SHIFT
				this.setKey(48, down); // 0
				return true;
				break;

			// ???
			case 0 : // EDIT
				this.setKey(16, down); // SHIFT
				this.setKey(49, down); // 1
				return true;
				break;

			// CAPS LOCK
			case 20 : // caps lock
				this.setKey(16, down); // SHIFT
				this.setKey(50, down); // 2
				return true;
				break;

			// ???
			case 0 : // TRUE VID
				this.setKey(16, down); // SHIFT
				this.setKey(51, down); // 3
				return true;
				break;

			// ???
			case 0 : // INV VID
				this.setKey(16, down); // SHIFT
				this.setKey(52, down); // 4
				return true;
				break;

			// LEFT
			case 0 : // keypad left
				this.setKey(16, down); // SHIFT
				this.setKey(53, down); // 5
				return true;
				break;

			// DOWN
			case 40 : // keypad down
				this.setKey(16, down); // SHIFT
				this.setKey(54, down); // 6
				return true;
				break;

			// UP
			case 38 : // keypad up
				this.setKey(16, down); // SHIFT
				this.setKey(55, down); // 7
				return;
				break;

			// RIGHT
			case 0 : // keypad right
				this.setKey(16, down); // SHIFT
				this.setKey(54, down); // 8
				return true;
				break;

			// ???
			case 0 : // graph
				this.setKey(16, down); // SHIFT
				this.setKey(57, down); // 9
				return true;
				break;
		}

		var keycode_map = [
			 { keycode:13, char:'enter', port:0xbffe, mask:0x01, name:'enter' }
			,{ keycode:16, char:'shift', port:0xfefe, mask:0x01, name:'caps shift' }
			,{ keycode:17, char:'ctrl',  port:0x7ffe, mask:0x02, name:'symbol shift' }
			,{ keycode:32, char:'space', port:0x7ffe, mask:0x01, name:'space' }

			,{ keycode:48, char:'0', port:0xeffe, mask:0x01 }
			,{ keycode:49, char:'1', port:0xf7fe, mask:0x01 }
			,{ keycode:50, char:'2', port:0xf7fe, mask:0x02 }
			,{ keycode:51, char:'3', port:0xf7fe, mask:0x04 }
			,{ keycode:52, char:'4', port:0xf7fe, mask:0x08 }
			,{ keycode:53, char:'5', port:0xf7fe, mask:0x10 }
			,{ keycode:54, char:'6', port:0xeffe, mask:0x10 }
			,{ keycode:55, char:'7', port:0xeffe, mask:0x08 }
			,{ keycode:56, char:'8', port:0xeffe, mask:0x04 }
			,{ keycode:57, char:'9', port:0xeffe, mask:0x02 }

			,{ keycode:65, char:'a', port:0xfdfe, mask:0x01 }
			,{ keycode:66, char:'b', port:0x7ffe, mask:0x10 }
			,{ keycode:67, char:'c', port:0xfefe, mask:0x08 }
			,{ keycode:68, char:'d', port:0xfdfe, mask:0x04 }
			,{ keycode:69, char:'e', port:0xfbfe, mask:0x04 }
			,{ keycode:70, char:'f', port:0xfdfe, mask:0x08 }
			,{ keycode:71, char:'g', port:0xfdfe, mask:0x10 }
			,{ keycode:72, char:'h', port:0xbffe, mask:0x10 }
			,{ keycode:73, char:'i', port:0xdffe, mask:0x04 }
			,{ keycode:74, char:'j', port:0xbffe, mask:0x08 }
			,{ keycode:75, char:'k', port:0xbffe, mask:0x04 }
			,{ keycode:76, char:'l', port:0xbffe, mask:0x02 }
			,{ keycode:77, char:'m', port:0x7ffe, mask:0x04 }
			,{ keycode:78, char:'n', port:0x7ffe, mask:0x08 }
			,{ keycode:79, char:'o', port:0xdffe, mask:0x02 }
			,{ keycode:80, char:'p', port:0xdffe, mask:0x01 }
			,{ keycode:81, char:'q', port:0xfbfe, mask:0x01 }
			,{ keycode:82, char:'r', port:0xfbfe, mask:0x08 }
			,{ keycode:83, char:'s', port:0xfdfe, mask:0x02 }
			,{ keycode:84, char:'t', port:0xfbfe, mask:0x10 }
			,{ keycode:85, char:'u', port:0xdffe, mask:0x08 }
			,{ keycode:86, char:'v', port:0xfefe, mask:0x10 }
			,{ keycode:87, char:'w', port:0xfbfe, mask:0x02 }
			,{ keycode:88, char:'x', port:0xfefe, mask:0x04 }
			,{ keycode:89, char:'y', port:0xdffe, mask:0x10 }
			,{ keycode:90, char:'z', port:0xfefe, mask:0x02 }
		];

		for (ki in keycode_map) {
			var k = keycode_map[ki];
			if (k.keycode == keycode) {
				if (down) {
					for (kpi in this.keyboard_ports) {
						var kp = this.keyboard_ports[kpi];
						if (kp.port == k.port) {
							kp.state &= ~k.mask;
							return true;
							break;
						}
					}
				} else {
					for (kpi in this.keyboard_ports) {
						var kp = this.keyboard_ports[kpi];
						if (kp.port == k.port) {
							kp.state |= k.mask;
							return true;
							break;
						}
					}
				}
			}
		}

		console.log('unhandled keycode', keycode);

		return false;
	}
	,setDebug: function(value) {
		this.debug = value;
		this.memory.debug = value;
		this.cpu.setDebug(value);
	}
	,stepInstructions: function(count) {
		if (this.run_timer) {
			clearInterval(this.run_timer);
		}
		this.cpu.stepInstructions(count);
	}
	,stepClocks: function(count) {
		if (this.run_timer) {
			clearInterval(this.run_timer);
		}
		this.cpu.stepClocks(count);
	}
	,run: function(count) {
		var self = this;
		var c = true;

		self.run_timer = setInterval(
			function() {
				c = self.cpu.stepClocks(70908);

				self.paint();
				self.frames += 1;

				if (!c) {
					console.log("breakpoint");
					clearInterval(self.run_timer);
					self.cpu.status();
				}
			}
			,20
		);
	}
	,reset: function() {
		var self = this;
		self.cpu.reset();
	}

	,paint: function() {
		var context = this.canvas.getContext('2d');
		var image_data = context.createImageData(
			256+this.border_left+this.border_right
			,192+this.border_top+this.border_bottom
		);

	/*
	total of 312 lines per frame
	each line takes 224 Tstates
	69888 Tstates per frame
	60+192+60 = 312
	*/

		var a_paper, a_ink, a_bright, a_flash = !!(this.frames & 16);
		var attr = 0, dots = 0;
		var scanline = 0;
		var block, offwrite, row, col, colour_ink, colour_paper, i;
		var border_colour;

		for (block = 0; block < 3; block++)
		for (offwrite = 0; offwrite < 8; offwrite++)
		for (row = 0; row < 8; row++)
		{
			attr = 6144 + (block*8 + row)*32;
			scanline = (block*64 + row*8 + offwrite + this.border_top) *
				(256+this.border_left+this.border_right);
			border_colour = this.ula.colours[
				this.ula.border_line[
					block*64 + row*8 + offwrite + this.border_top
				]
			];

			for (i = 0; i<this.border_left; i++)
			{
				image_data.data[scanline*4+0] = border_colour[0];
				image_data.data[scanline*4+1] = border_colour[1];
				image_data.data[scanline*4+2] = border_colour[2];
				image_data.data[scanline*4+3] = border_colour[3];
				scanline++;
			}
			for (col = 0; col < 32; col++) {
				a_bright = (this.memory.ram[attr] & 64) >> 3;
				a_paper = ((this.memory.ram[attr] & 56) >> 3) + a_bright;
				a_ink = (this.memory.ram[attr] & 7) + a_bright;

				if (a_flash && (this.memory.ram[attr] & 0x80)) {
					colour_ink = this.ula.colours[a_ink];
					colour_paper = this.ula.colours[a_paper];
				} else {
					colour_ink = this.ula.colours[a_paper];
					colour_paper = this.ula.colours[a_ink];
				}

				for (i = 0x80; i > 0; i>>=1) {
					if (this.memory.ram[dots] & i) {
						image_data.data[scanline*4+0] = colour_paper[0];
						image_data.data[scanline*4+1] = colour_paper[1];
						image_data.data[scanline*4+2] = colour_paper[2];
						image_data.data[scanline*4+3] = colour_paper[3];
					} else {
						image_data.data[scanline*4+0] = colour_ink[0];
						image_data.data[scanline*4+1] = colour_ink[1];
						image_data.data[scanline*4+2] = colour_ink[2];
						image_data.data[scanline*4+3] = colour_ink[3];

					}
					scanline++;
				}

				dots++;
				attr++;
			}

			for (i = 0; i<this.border_right; i++)
			{
				image_data.data[scanline*4+0] = border_colour[0];
				image_data.data[scanline*4+1] = border_colour[1];
				image_data.data[scanline*4+2] = border_colour[2];
				image_data.data[scanline*4+3] = border_colour[3];
				scanline++;
			}
		}

		i = 0;
		for (y = 0; y < this.border_top; y++) {
			for (x=0; x < 256+this.border_left+this.border_right; x++) {
				image_data.data[i+0] = this.ula.colours[this.ula.border_line[y]][0];
				image_data.data[i+1] = this.ula.colours[this.ula.border_line[y]][1];
				image_data.data[i+2] = this.ula.colours[this.ula.border_line[y]][2];
				image_data.data[i+3] = this.ula.colours[this.ula.border_line[y]][3];
				i+=4;
			}
		}

		i = (192+this.border_top)*(256+this.border_left+this.border_right)*4;
		for (y = 192+this.border_top; y < 192+this.border_top+this.border_bottom; y++) {
			for (x=0; x < 256+this.border_left+this.border_right; x++) {

				image_data.data[i+0] = this.ula.colours[this.ula.border_line[y]][0];
				image_data.data[i+1] = this.ula.colours[this.ula.border_line[y]][1];
				image_data.data[i+2] = this.ula.colours[this.ula.border_line[y]][2];
				image_data.data[i+3] = this.ula.colours[this.ula.border_line[y]][3];
				i+=4;
			}
		}

		context.putImageData(image_data, 0, 0);
	}

	,setBorder: function(value) {
		var y = ((this.cpu.clocks_per_irq - this.cpu.clocks_to_irq)/this.cpu.clocks_per_irq)*
			(this.border_top + this.border_bottom + 192);
		y = Math.floor(y);
		if (this.last_border_line_y <= y) {
			for (var yf=this.last_border_line_y; yf < y; yf++) {
				this.ula.border_line[yf] = this.last_border_line_value;
			}
			this.ula.border_line[y] = value & 0x7;
			this.last_border_line_value = value & 0x7;
			this.last_border_line_y = y;
		} else {
			for (var yf=this.last_border_line_y; yf < this.ula.border_line.length; yf++) {
				this.ula.border_line[yf] = this.last_border_line_value;
			}
			for (var yf=0; yf < y; yf++) {
				this.ula.border_line[yf] = this.last_border_line_value;
			}
			this.ula.border_line[y] = value & 0x7;
			this.last_border_line_value = value & 0x7;
			this.last_border_line_y = y;
		}
	}
	,setBorderAll: function(value) {
		this.ula.border = value;
		for (var i = 0; i < this.ula.border_line.length; i++) {
			this.ula.border_line[i] = value & 0x7;
		}
	}
	,loadSNA: function(filename) {
		var self = this;
		$.ajax({
			url: filename
			,async: false
			,responseType: 'arraybuffer'
			,mimeType: 'text/plain; charset=x-user-defined'
			,success: function(response) {
				var read8 = function(offset) {
					return response.charCodeAt(offset) & 0xff;
				};

				var readLE16 = function(offset) {
					var v = response.charCodeAt(offset) & 0xff;
					v += (response.charCodeAt(offset+1) & 0xff) * 0x100;
					return v;
				};

				var loads = [
					[ self.cpu.writeI,   read8,    0 ],
					[ self.cpu.writeHL2, readLE16, 1 ],
					[ self.cpu.writeDE2, readLE16, 3 ],
					[ self.cpu.writeBC2, readLE16, 5 ],
					[ self.cpu.writeAF2, readLE16, 7 ],
					[ self.cpu.writeHL,  readLE16, 9 ],
					[ self.cpu.writeDE,  readLE16, 11 ],
					[ self.cpu.writeBC,  readLE16, 13 ],
					[ self.cpu.writeIY,  readLE16, 15 ],
					[ self.cpu.writeIX,  readLE16, 17 ],
					[
						self.cpu.writeIFF2,
						function(offset) { return !read8(offset) & 4 ? 1 : 0; },
						19
					],
					[ self.cpu.writeR,   read8,    20 ],
					[ self.cpu.writeAF,  readLE16, 21 ],
					[ self.cpu.writeSP,  readLE16, 23 ],
					[ self.cpu.writeIM,  read8,    25 ],
/*
					[
						self.setBorderAll.call(self),
						function(offset) { return read8(offset) & 7; },
						26
					],
*/
				];

				for (var loads_index in loads) {
					var load = loads[loads_index];
					load[0].call(self.cpu, load[1](load[2]));
				}

				for (var i=27; i < response.length; i++) {
					var x = response.charCodeAt(i) & 0xff;
					self.memory.ram[i-27] = x;
				}

				// RETN to load PC/IFF1
				self.cpu.writePC(self.memory.sread16(self.cpu.readSP()));
				self.cpu.writeSP(self.cpu.readSP() + 2);
				self.cpu.writeIFF1(self.cpu.readIFF2());

				self.paint();
				self.cpu.status();
			}
		});
	}
};

var Z80 = function() {
	var self = this;

	self.zymosis_compatible = true;

	self.reset();

	// catch-all operand for dd/fd fallthrough
	self.operand_all = {
		mask: 0xff
		,read: function(i) { }
		,write: function(i, v) { }
	};

	self.operand_ry = {
		mask: 0x38
		,read: function(i) {
			switch (i) {
				case 0 : return self.readB();
				case 1 : return self.readC();
				case 2 : return self.readD();
				case 3 : return self.readE();
				case 4 : return self.readH();
				case 5 : return self.readL();
				case 6 : return self.mmu.read8(self.readHL());
				case 7 : return self.readA();
				default : console.log("operand_ry: invalid index:" + i); break;
			}
		}
		,write: function(i, v) {
			switch (i) {
				case 0 : self.writeB(v); break;
				case 1 : self.writeC(v); break;
				case 2 : self.writeD(v); break;
				case 3 : self.writeE(v); break;
				case 4 : self.writeH(v); break;
				case 5 : self.writeL(v); break;
				case 6 : self.mmu.write8(self.readHL(), v); break;
				case 7 : self.writeA(v); break;
				default : console.log("operand_ry: invalid index:" + i); break;
			}
		}
		,disasm: function(i) {
			return ["B","C","D","E","H","L","(HL)","A"][i];
		}
	};

	self.operand_rz = {
		mask: 0x07
		,read: function(i) {
			return self.operand_ry.read(i);
		}
		,write: function(i, v) {
			self.operand_ry.write(i, v);
		}
		,disasm: function(i) {
			return self.operand_ry.disasm(i);
		}
	};

	self.operand_rp = {
		mask: 0x30
		,read: function(i) {
			switch (i) {
				case 0 : return self.readBC();
				case 1 : return self.readDE();
				case 2 : return self.readHL();
				case 3 : return self.readSP();
				default : console.log("operand_rp.read: invalid index:" + i); break;
			}
		}
		,write: function(i, v) {
			switch (i) {
				case 0 : self.writeBC(v); break;
				case 1 : self.writeDE(v); break;
				case 2 : self.writeHL(v); break;
				case 3 : self.writeSP(v); break;
				default : console.log("operand_rp.write: invalid index:" + i); break;
			}
		}
		,disasm: function(i) {
			return ["BC","DE","HL","SP"][i];
		}
	};

	self.operand_rp2 = {
		mask: 0x30
		,read: function(i) {
			switch (i) {
				case 0 : return self.readBC();
				case 1 : return self.readDE();
				case 2 : return self.readHL();
				case 3 : return self.readAF();
				default : console.log("operand_rp2.read: invalid index:" + i); break;
			}
		}
		,write: function(i, v) {
			switch (i) {
				case 0 : self.writeBC(v); break;
				case 1 : self.writeDE(v); break;
				case 2 : self.writeHL(v); break;
				case 3 : self.writeAF(v); break;
				default : console.log("operand_rp2.write: invalid index:" + i); break;
			}
		}
		,disasm: function(i) {
			return ["BC","DE","HL","AF"][i];
		}
	};

	self.operand_ddry = {
		mask: self.operand_ry.mask
		,read: function(i) {
			switch (i) {
				case 4 : return self.readHX();
				case 5 : return self.readLX();
				case 6 : {
					self.displacement_skip = 1;
					return self.mmu.read8(self.readIX() + self.displacement);
				}
				default : return self.operand_ry.read(i);
			}
		}
		,write: function(i, v) {
			switch (i) {
				case 4 : self.writeHX(v); break;
				case 5 : self.writeLX(v); break;
				case 6 : {
					self.displacement_skip = 1;
					self.mmu.write8(self.readIX() + self.displacement, v);
					break;
				}
				default : self.operand_ry.write(i, v); break;
			}
		}
		,disasm: function(i) {
			switch (i) {
				case 4 : return "HX";
				case 5 : return "LX";
				case 6 : return "(IX+d)";
			}
			return self.operand_ry.disasm(i);
		}
	};

	self.operand_ddrz = {
		mask: self.operand_rz.mask
		,read: self.operand_ddry.read
		,write: self.operand_ddry.write
		,disasm: self.operand_ddry.disasm
	};

	self.operand_ddrp = {
		mask: self.operand_rp.mask
		,read: function(i) {
			switch (i) {
				case 2 : return self.readIX();
				default : return self.operand_rp.read(i);
			}
		}
		,write: function(i, v) {
			switch (i) {
				case 2 : self.writeIX(v); break;
				default : self.operand_rp.write(i, v); break;
			}
		}
		,disasm: function(i) {
			return ["BC","DE","IX","SP"][i];
		}
	};

	self.operand_ddrp2 = {
		mask: self.operand_rp2.mask
		,read: function(i) {
			switch (i) {
				case 2 : return self.readIX();
				default : return self.operand_rp2.read(i);
			}
		}
		,write: function(i, v) {
			switch (i) {
				case 2 : self.writeIX(v); break;
				default : self.operand_rp2.write(i, v); break;
			}
		}
		,disasm: function(i) {
			return ["BC","DE","IX","AF"][i];
		}
	};

	self.operand_ddcbrz = {
		mask: self.operand_rz.mask
		,read: function(i, v) {
			var address = self.readIX() + self.displacement;
			self.writeMEMPTR(address);
			return self.mmu.read8(address);
		}
		,write: function(i, v) {
			var address = self.readIX() + self.displacement;
			self.writeMEMPTR(address);
			self.mmu.write8(address, v);
			if (i != 6) {
				// handle undocumented DDCB instructions
				// if register operand specified, write result back to register as well
				self.operand_ry.write(i, v);
			}
		}
		,disasm: function(i) {
			var d = self.displacement;
			var ds = sprintf("%s%02X", (d >= 0 ? "+" : "-"), (d >= 0 ? d : 256-d));
			if (i == 6) {
				s = sprintf("(IX%s)", ds);
			} else {
				s = sprintf("(IX%s)->%s", ds, self.operand_ry.disasm(i));
			}
			return s;
		}
	};

	self.operand_fdry = {
		mask: self.operand_ry.mask
		,read: function(i) {
			switch (i) {
				case 4 : return self.readHY();
				case 5 : return self.readLY();
				case 6 : {
					self.displacement_skip = 1;
					var displacement = u2s8(self.mmu.read8(self.readPC()+2));
					return self.mmu.read8(self.readIY() + displacement);
				}
				default : return self.operand_ry.read(i);
			}
		}
		,write: function(i, v) {
			switch (i) {
				case 4 : self.writeHY(v); break;
				case 5 : self.writeLY(v); break;
				case 6 : {
					self.displacement_skip = 1;
					self.mmu.write8(self.readIY() + self.displacement, v);
					break;
				}
				default : self.operand_ry.write(i, v); break;
			}
		}
		,disasm: function(i) {
			switch (i) {
				case 4 : return "HY";
				case 5 : return "LY";
				case 6 : return "(IY+d)";
			}
			return self.operand_ry.disasm(i);
		}
	};

	self.operand_fdrz = {
		mask: self.operand_rz.mask
		,read: self.operand_fdry.read
		,write: self.operand_fdry.write
	};

	self.operand_fdrp = {
		mask: self.operand_rp.mask
		,read: function(i) {
			switch (i) {
				case 2 : return self.readIY();
				default : return self.operand_rp.read(i);
			}
		}
		,write: function(i, v) {
			switch (i) {
				case 2 : self.writeIY(v); break;
				default : self.operand_rp.write(i, v); break;
			}
		}
		,disasm: function(i) {
			return ["BC","DE","IY","SP"][i];
		}
	};

	self.operand_fdrp2 = {
		mask: self.operand_rp2.mask
		,read: function(i) {
			switch (i) {
				case 2 : return self.readIY();
				default : return self.operand_rp2.read(i);
			}
		}
		,write: function(i, v) {
			switch (i) {
				case 2 : self.writeIY(v); break;
				default : self.operand_rp2.write(i, v); break;
			}
		}
		,disasm: function(i) {
			return ["BC","DE","IY","AF"][i];
		}
	};

	self.operand_fdcbrz = {
		mask: self.operand_rz.mask
		,read: function(i, v) {
			return self.mmu.read8(self.readIY() + self.displacement);
		}
		,write: function(i, v) {
			self.mmu.write8(self.readIY() + self.displacement, v);
			if (i != 6) {
				// handle undocumented FDCB instructions
				// if register operand specified, write result back to register as well
				self.operand_ry.write(i, v);
			}
		}
		,disasm: function(i) {
			var d = self.displacement;
			var ds = sprintf("%s%02X", (d >= 0 ? "+" : "-"), (d >= 0 ? d : 256-d));
			if (i == 6) {
				s = sprintf("(IY%s)", ds);
			} else {
				s = sprintf("(IY%s)->%s", ds, self.operand_ry.disasm(i));
			}
			return s;
		}
	};

	self.operand_ccy = {
		mask: 0x38
		,disasm: function(i) {
			return ['NZ','Z','NC','C','PO','PE','P','M'][i];
		}
	};

	self.operand_ccy4 = {
		mask: 0x18
		,disasm: function(i) {
			return ['NZ','Z','NC','C'][i];
		}
	};

	self.operand_rst = {
		mask: 0x38
		,disasm: function(i) {
			return '' + i*8;
		}
	};

	self.operand_bit = {
		mask: 0x38
		,disasm: function(i) {
			return '' + (i >> 3);
		}
	};

	self.base_adc8 = function(d, s) {
		// FIXME: adc a,0 (c=1 a=0xff) -> f becomes 0x01 should be 0x51
		var c = !!self.getFC();
		var r = s + d + c;
		if (r & 0x80) { self.setFS(); } else { self.resetFS(); }
		if ((r & 0xff) == 0) { self.setFZ(); } else { self.resetFZ(); }
		if (r & 0x20) { self.setF5(); } else { self.resetF5(); }
		if (((s & 0xf) + (d & 0xf) + c) >= 16) { self.setFH(); } else { self.resetFH(); }
		if (r & 0x08) { self.setF3(); } else { self.resetF3(); }
		if ((s ^ r) & (d ^ r) & 0x80) { self.setFV(); } else { self.resetFV(); }
		self.resetFN();
		if (r >= 0x100) { self.setFC(); } else { self.resetFC(); }
		return r;
	};

	self.base_sbc8 = function(d, s) {
		var c = !!self.getFC();
		var r = (d - s - c) & 0xffff;
		if (r & 0x80) { self.setFS(); } else { self.resetFS(); }
		if ((r & 0xff) == 0) { self.setFZ(); } else { self.resetFZ(); }
		if (r & 0x20) { self.setF5(); } else { self.resetF5(); }
		if (((d & 0x0f) - (s & 0xf) - c) < 0) { self.setFH(); } else { self.resetFH(); }
		if (r & 0x08) { self.setF3(); } else { self.resetF3(); }
		if ((s ^ d) & (d ^ r) & 0x80) { self.setFV(); } else { self.resetFV(); }
		self.setFN();
		if (r >= 0x100) { self.setFC(); } else { self.resetFC(); }
		return r & 0xff;
	};

	self.base_and8 = function(d, s) {
		var r = d & s;
		if (r & 0x80) { self.setFS(); } else { self.resetFS(); }
		if (r == 0) { self.setFZ(); } else { self.resetFZ(); }
		if (r & 0x20) { self.setF5(); } else { self.resetF5(); }
		self.setFH();
		if (r & 0x08) { self.setF3(); } else { self.resetF3(); }
		if (self.parity(r)) { self.setFP(); } else { self.resetFP(); }
		self.resetFN();
		self.resetFC();
		return r;
	};

	self.base_xor8 = function(d, s) {
		var r = d ^ s;
		if (r & 0x80) { self.setFS(); } else { self.resetFS(); }
		if (r == 0) { self.setFZ(); } else { self.resetFZ(); }
		if (r & 0x20) { self.setF5(); } else { self.resetF5(); }
		self.resetFH();
		if (r & 0x08) { self.setF3(); } else { self.resetF3(); }
		if (self.parity(r)) { self.setFP(); } else { self.resetFP(); }
		self.resetFN();
		self.resetFC();
		return r;
	};

	self.base_or8 = function(d, s) {
		var r = d | s;
		if (r & 0x80) { self.setFS(); } else { self.resetFS(); }
		if (r == 0) { self.setFZ(); } else { self.resetFZ(); }
		if (r & 0x20) { self.setF5(); } else { self.resetF5(); }
		self.resetFH();
		if (r & 0x08) { self.setF3(); } else { self.resetF3(); }
		if (self.parity(r)) { self.setFP(); } else { self.resetFP(); }
		self.resetFN();
		self.resetFC();
		return r;
	};

	self.base_cp8 = function(d, s) {
		var r = (d - s) & 0xff;
		if (r & 0x80) { self.setFS(); } else { self.resetFS(); }
		if (r == 0) { self.setFZ(); } else { self.resetFZ(); }
		if (s & 0x20) { self.setF5(); } else { self.resetF5(); }
		if ((s&0xf) > (d&0xf)) { self.setFH(); } else { self.resetFH(); }
		if (s & 0x08) { self.setF3(); } else { self.resetF3(); }
		if ((s ^ d) & (d ^ r) & 0x80) { self.setFV(); } else { self.resetFV(); }
		self.setFN();
		if (s > d) { self.setFC(); } else { self.resetFC(); }
	};

	self.instructions = {
		nop: {
			disasm: "NOP"
			,c:4
			,s:1
			, exec: function(i, o) {
			}
		}
		,cb_prefix: {
			disasm: "CB PREFIX"
			,c: 4
			,s: 0
			,exec: function(i) {
				var o = self.mmu.read8(this.readPC()+1);
				var d = self.opcode_descriptions.cb[o];
				if (d.handler === undefined) {
					console.error("unhandled CB opcode ", o.toString(16), d);
					this.writePC(self.readPC() + 2);
					return;
				}
				d.handler.call(self, d);
				this.clocks += d.clocks;
				this.r_add = 2;
				return d;
			}
		}
		,ed_prefix: {
			disasm: "ED PREFIX"
			,c: 4
			,s: 0
			,exec: function(i) {
				this.immediate_address = this.readPC() + 2;
				var o = self.mmu.read8(this.readPC()+1);
				var d = self.opcode_descriptions.ed[o];
				if (d.handler === undefined) {
					console.error("unhandled ED opcode ", o.toString(16), d);
					debugger;
				}
				d.handler.call(self, d);
				this.r_add = 2;
				return d;
			}
		}
		,ed_unimplemented: { disasm: "ED UNIMP", c:4, s:2
			,exec: function(i) {
				console.error("unhandled ED opcode ", i);
				debugger;
			}
		}
		,dd_prefix: {
			disasm: "DD PREFIX"
			,c: 4
			,s: 1
			,exec: function(i) {
				this.immediate_address = this.readPC() + 2;
				var o = self.mmu.read8(this.readPC()+1);
				var d = self.opcode_descriptions.dd[o];
				if (d.handler === undefined) {
					console.error(o.toString(16), d);
					debugger;
				}
				this.prefix_bytes = 1;
				var nd = d.handler.call(self, d);
				if (typeof nd === 'undefined') {
					nd = d;
				}
				this.r_add = 2;
				return nd;
			}
		}
		,fd_prefix: {
			disasm: "FD PREFIX"
			,c: 4
			,s: 1
			,exec: function(i) {
				this.immediate_address = this.readPC() + 2;
				var o = self.mmu.read8(this.readPC()+1);
				var d = self.opcode_descriptions.fd[o];
				if (d.handler === undefined) {
					console.error(o.toString(16), d);
					debugger;
				}
				this.prefix_bytes = 1;
				var nd = d.handler.call(self, d);
				if (typeof nd === 'undefined') {
					nd = d;
				}
				this.r_add = 2;
				return nd;
			}
		}
		,dd_fallthrough: { disasm: "DD FALL", c:0, s:0
			,exec: function(i) {
				var o = i.operands[0];
				var d = self.opcode_descriptions.main[o];
				if (d.handler === undefined) {
					console.error(o.toString(16), d);
					return;
				}
				d.handler.call(self, d);
				return d;
			}
		}
		,fd_fallthrough: { disasm: "FD FALL", c:0, s:0
			,exec: function(i) {
				var o = i.operands[0];
				var d = self.opcode_descriptions.main[o];
				if (d.handler === undefined) {
					console.error(o.toString(16), d);
					return;
				}
				d.handler.call(self, d);
				return d;
			}
		}
		,ddcb_prefix: {
			disasm: "DDCB PREFIX"
			,c: 4
			,s: 4
			,exec: function(i) {
				self.prefix_bytes = 0;
				self.displacement = u2s8(self.mmu.read8(this.readPC()+2));
				var o = self.mmu.read8(this.readPC()+3);
				var d = self.opcode_descriptions.ddcb[o];
				if (d.handler === undefined) {
					console.error(o.toString(16), d);
					return;
				}
				d.handler.call(self, d);
			}
		}
		,fdcb_prefix: {
			disasm: "FDCB PREFIX"
			,c: 4
			,s: 4
			,exec: function(i) {
				self.prefix_bytes = 0;
				self.displacement = u2s8(self.mmu.read8(this.readPC()+2));
				var o = self.mmu.read8(this.readPC()+3);
				var d = self.opcode_descriptions.fdcb[o];
				if (d.handler === undefined) {
					console.error(o.toString(16), d);
					return;
				}
				d.handler.call(self, d);
			}
		}
		,ld_ry_rz: { disasm: "LD %0,%1", c:4, s:1, exec: function(i) {
			i.operand_hook[0].write(
				i.operands[0],
				i.operand_hook[1].read(i.operands[1])
			);
			if (i.operands[0] == 6 || i.operands[1] == 6) {
				self.clocks += 3;
			}
		} }
		,ld_a_ib: { disasm: "LD A,%ib", c:7, s:2, exec: function(i) {
			self.writeA(self.immediate8());
		} }
		,ld_ry_ib: { disasm: "LD %0,%ib", c:4, s:2, exec: function(i) {
			i.operand_hook[0].write(i.operands[0], self.immediate8());
		} }
		,ld_rp_iw: { disasm: "LD %0,%iw", c:11, s:3, exec: function(i) {
			i.operand_hook[0].write(i.operands[0], self.immediate16());
		} }

		,ld_a_mi: { disasm: "LD A,(%iw)", c:13, s:3, exec: function(i) {
			var r = self.immediate16();
			self.writeMEMPTR((self.readA() << 8) | ((r + 1) & 0xff));
			self.writeA(self.mmu.read8(r));
		} }
		,ld_mi_a: { disasm: "LD (%iw),A", c:7, s:3, exec: function(i) {
			var a = self.readA();
			self.writeMEMPTR(a << 8);
			self.mmu.write8(self.immediate16(), a);
		} }

		,ld_mrp_a: { disasm: "LD (%0),A", c:13, s:1, exec: function(i) {
			var a = self.readA();
			var address = i.operand_hook[0].read(i.operands[0]);
			self.writeMEMPTR((a << 8) | ((address+1) & 0xff));
			self.mmu.write8(address, a);
		} }

		,ld_a_mbc: { disasm: "LD A,(BC)", c:7, s:1, exec: function(i) {
			var r = self.readBC();
			self.writeA(self.mmu.read8(r));
			self.writeMEMPTR(r + 1);
		} }
		,ld_a_mde: { disasm: "LD A,(DE)", c:7, s:1, exec: function(i) {
			var r = self.readDE();
			self.writeA(self.mmu.read8(r));
			self.writeMEMPTR(r + 1);
		} }

		// main group HL <-> memory-immediate loads
		,ld_hl_mi: { disasm: "LD HL,(%iw)", c:16, s:3, exec: function(i) {
			var r = self.immediate16();
			self.writeHL(self.mmu.read16(r));
			self.writeMEMPTR(r + 1);
		} }
		,ld_ix_mi: { disasm: "LD IX,(%iw)", c:20, s:3, exec: function(i) {
			var r = self.immediate16();
			self.writeIX(self.mmu.read16(r));
			self.writeMEMPTR(r + 1);
		} }
		,ld_iy_mi: { disasm: "LD IY,(%iw)", c:20, s:3, exec: function(i) {
			var r = self.immediate16();
			self.writeIY(self.mmu.read16(r));
			self.writeMEMPTR(r + 1);
		} }
		,ld_mi_hl: { disasm: "LD (%iw),HL", c:16, s:3, exec: function(i) {
			var r = self.immediate16();
			self.mmu.write16(r, self.readHL());
			self.writeMEMPTR(r + 1);
		} }
		,ld_mi_ix: { disasm: "LD (%iw),IX", c:20, s:3, exec: function(i) {
			var r = self.immediate16();
			self.mmu.write16(r, self.readIX());
			self.writeMEMPTR(r + 1);
		} }
		,ld_mi_iy: { disasm: "LD (%iw),IY", c:20, s:3, exec: function(i) {
			var r = self.immediate16();
			self.mmu.write16(r, self.readIY());
			self.writeMEMPTR(r + 1);
		} }

		// ED prefix RP <-> memory-immediate loads
		,ld_rp_mi: { disasm: "LD %0,(%iw)", c:20, s:4, exec: function(i) {
			i.operand_hook[0].write(
				i.operands[0],
				self.mmu.read16(
					self.immediate16()
				)
			);
		} }
		,ld_mi_rp: { disasm: "LD (%iw),%0", c:20, s:4, exec: function(i) {
			var address = self.immediate16();
			self.writeMEMPTR(address+1);
			self.mmu.write16(
				address,
				i.operand_hook[0].read(
					i.operands[0]
				)
			);
		} }

		// SP loads
		,ld_sp_hl: { disasm: "LD SP,HL", c:6, s:1, exec: function(i) {
			self.writeSP(self.readHL());
		} }
		,ld_sp_ix: { disasm: "LD SP,IX", c:6, s:1, exec: function(i) {
			self.writeSP(self.readIX());
		} }
		,ld_sp_iy: { disasm: "LD SP,IY", c:6, s:1, exec: function(i) {
			self.writeSP(self.readIY());
		} }

		,ld_ry_mix: { disasm: "LD %0,(IX+%d)", c:15, s:2, exec: function(i) {
			var d = u2s8(self.mmu.read8(self.readPC()+2));
			i.operand_hook[0].write(
				i.operands[0], self.mmu.read8(self.readIX() + d)
			);
		} }
		,ld_ry_miy: { disasm: "LD %0,(IY+%d)", c:15, s:2, exec: function(i) {
			var d = u2s8(self.mmu.read8(self.readPC()+2));
			i.operand_hook[0].write(
				i.operands[0], self.mmu.read8(self.readIY() + d)
			);
		} }

		,ld_mix_rz: { disasm: "LD (IX+%d),%0", c:15, s:2, exec: function(i) {
			var d = u2s8(self.mmu.read8(self.readPC()+2));
			self.mmu.write8(
				self.readIX() + d
				,i.operand_hook[0].read(i.operands[0])
			);
		} }
		,ld_miy_rz: { disasm: "LD (IY+%d),%0", c:15, s:2, exec: function(i) {
			var d = u2s8(self.mmu.read8(self.readPC()+2));
			self.mmu.write8(
				self.readIY() + d
				,i.operand_hook[0].read(i.operands[0])
			);
		} }

		,ld_mix_ib: { disasm: "LD (IX+%d),%ib", c:15, s:4, exec: function(i) {
			var d = u2s8(self.mmu.read8(self.readPC()+2));
			self.mmu.write8(
				self.readIX() + d
				,self.mmu.read8(self.readPC()+3)
			);
		} }
		,ld_miy_ib: { disasm: "LD (IY+%d),%ib", c:15, s:3, exec: function(i) {
			var d = u2s8(self.mmu.read8(self.readPC()+2));
			self.mmu.write8(
				self.readIY() + d
				,self.mmu.read8(self.readPC()+3)
			);
		} }

		,ld_i_a: { disasm: "LD I,A", c:5, s:2, exec: function(i) {
			self.writeI(self.readA());
			if (self.zymosis_compatible) {
			} else {
				if (self.r.IFF2) { self.setFP(); } else { self.resetFP(); }
			}
		} }
		,ld_a_i: { disasm: "LD A,I", c:5, s:2, exec: function(i) {
			self.writeA(self.readI());
			if (self.r.IFF2) { self.setFP(); } else { self.resetFP(); }
		} }

		,ld_r_a: { disasm: "LD R,A", c:5, s:2, exec: function(i) {
			self.writeR(self.readA());
		} }
		,ld_a_r: { disasm: "LD A,R", c:5, s:2, exec: function(i) {
			self.writeA(self.readR());
		} }


		// 8-bit increment/decrement
		,inc_ry: { disasm: "INC %0", c:4, s:1, exec: function(i) {
			var s = i.operand_hook[0].read(i.operands[0]);
			var r = (s + 1) & 0xff;

			if (r & 0x80) { self.setFS(); } else { self.resetFS(); }
			if (!r) { self.setFZ(); } else { self.resetFZ(); }
			if (r & 0x20) { self.setF5(); } else { self.resetF5(); }
			if ((r & 0xf) == 0) { self.setFH(); } else { self.resetFH(); }
			if (r & 0x08) { self.setF3(); } else { self.resetF3(); }
			if (s == 0x7f) { self.setFV(); } else { self.resetFV(); }
			self.resetFN();
			// carry unchanged

			i.operand_hook[0].write(i.operands[0], r);
		} }
		,dec_ry: { disasm: "DEC %0", c:4, s:1, exec: function(i) {
			var s = i.operand_hook[0].read(i.operands[0]);
			var r = (s - 1) & 0xff;

			if (r & 0x80) { self.setFS(); } else { self.resetFS(); }
			if (!r) { self.setFZ(); } else { self.resetFZ(); }
			if (r & 0x20) { self.setF5(); } else { self.resetF5(); }
			if ((r & 0xf) == 0xf) { self.setFH(); } else { self.resetFH(); }
			if (r & 0x08) { self.setF3(); } else { self.resetF3(); }
			if (s == 0x7f) { self.setFV(); } else { self.resetFV(); }
			self.setFN();
			// carry unchanged

			i.operand_hook[0].write(i.operands[0], r);
		} }

		// 16-bit increment/decrement
		,inc_rp: { disasm: "INC %0", c:6, s:1, exec: function(i) {
			var s = i.operand_hook[0].read(i.operands[0]);
			var r = s + 1;
			i.operand_hook[0].write(i.operands[0], r);
		} }
		,dec_rp: { disasm: "DEC %0", c:6, s:1, exec: function(i) {
			var s = i.operand_hook[0].read(i.operands[0]);
			var r = s - 1;
			i.operand_hook[0].write(i.operands[0], r);
		} }

		// 8-bit relative jump
		,jr: { disasm: "JR %d", c:12, s:2, exec: function(i) {
			self.displacement = u2s8(self.immediate8());
			var target = self.readPC() + self.displacement;
			self.writeMEMPTR(target);
			self.writePC(target);
		} }
		,jr_ccy4: { disasm: "JR %0,%d", c:7, s:2, exec: function(i) {
			self.displacement = u2s8(self.immediate8());
			var target = self.readPC() + self.displacement;
			if (self.testCondition(i.operands[0])) {
				self.writeMEMPTR(target + 2);
				self.writePC(target);
			}
		} }
		,djnz: { disasm: "DJNZ %d", c:8, s:2, exec: function(i) {
			self.writeB(self.readB() - 1);
			self.displacement = u2s8(self.immediate8());
			if (self.readB()) {
				var target = self.readPC() + self.displacement;
				self.writeMEMPTR(target);
				self.writePC(target);
			}
		} }

		// 16-bit absolute jump
		,jp: { disasm: "JP %iw", c:10, s:3, exec: function(i) {
			var target = self.immediate16();
			self.writeMEMPTR(target);
			self.writePC(target - 3);
		} }
		,jp_ccy: { disasm: "JP %0,%iw", c:10, s:3, exec: function(i) {
			var target = self.immediate16();
			if (self.testCondition(i.operands[0])) {
				self.writeMEMPTR(target);
				self.writePC(target - 3);
			}
		} }
		,jp_hl: { disasm: "JP (HL)", c:4, s:1, exec: function(i) {
			var target = self.readHL();
			self.writeMEMPTR(target);
			self.writePC(target - 1);
		} }
		,jp_ix: { disasm: "JP (IX)", c:4, s:1, exec: function(i) {
			var target = self.readIX();
			self.writeMEMPTR(target);
			self.writePC(target - 1);
		} }
		,jp_iy: { disasm: "JP (IY)", c:4, s:1, exec: function(i) {
			var target = self.readIY();
			self.writeMEMPTR(target);
			self.writePC(target - 1);
		} }

		// 8-bit ALU group with A register
		,rlca: { disasm: "RLCA", c:4, s:1, exec: function(i) {
			var s = self.readA();
			var r = ((s << 1) | ( s >> 7)) & 0xff;
			self.resetFH();
			self.resetFN();
			if (s & 0x80) { self.setFC(); } else { self.resetFC(); }
			if (r & 0x20) { self.setF5(); } else { self.resetF5(); }
			if (r & 0x08) { self.setF3(); } else { self.resetF3(); }

			self.writeA(r);
		} }
		,rrca: { disasm: "RRCA", c:4, s:1, exec: function(i) {
			var s = self.readA();
			var r = ((s >> 1) | ( s << 7)) & 0xff;
			self.resetFH();
			self.resetFN();
			if (r & 0x08) { self.setF3(); } else { self.resetF3(); }
			if (r & 0x20) { self.setF5(); } else { self.resetF5(); }
			if (s & 0x01) { self.setFC(); } else { self.resetFC(); }

			self.writeA(r);
		} }
		,rla: { disasm: "RLA", c:4, s:1, exec: function(i) {
			var s = self.readA();
			var r = ((s << 1) & 0xff) | (self.getFC() ? 0x01 : 0x00);
			if (s & 0x80) { self.setFC(); } else { self.resetFC(); }
			if (r & 0x20) { self.setF5(); } else { self.resetF5(); }
			if (r & 0x08) { self.setF3(); } else { self.resetF3(); }
			self.resetFH();
			self.resetFN();
			self.writeA(r);
		} }
		,rra: { disasm: "RRA", c:4, s:1, exec: function(i) {
			var s = self.readA();
			var r = (s >> 1) & 0xff;
			if (self.getFC()) { r |= 0x80; }
			if (r & 0x20) { self.setF5(); } else { self.resetF5(); }
			if (r & 0x08) { self.setF3(); } else { self.resetF3(); }
			if (s & 0x01) { self.setFC(); } else { self.resetFC(); }
			self.resetFH();
			self.resetFN();
			self.writeA(r);
		} }

		,rld: { disasm: "RLD", c:18, s:1, exec: function(i) {
			var shl = self.readHL();
			self.writeMEMPTR(shl + 1);

			var sa = self.readA();
			var smhl = self.mmu.read8(shl);
			var dmhl = ((smhl & 0xf) << 4) | (sa & 0xf);
			var r = (sa & 0xf0) | (((smhl & 0xf0) >> 4) & 0xff);

			// cite:1 says C is changed, cite:3 says it is not changed
			//if (r & 0x80) { self.setFC(); } else { self.resetFC(); }
			if (r == 0) { self.setFZ(); } else { self.resetFZ(); }
			if (self.parity(r)) { self.setFP(); } else { self.resetFP(); }
			self.resetFH();
			self.resetFN();
			if (r & 0x20) { self.setF5(); } else { self.resetF5(); }
			if (r & 0x08) { self.setF3(); } else { self.resetF3(); }

			self.mmu.write8(shl, dmhl);
			self.writeA(r);
		} }
		,rrd: { disasm: "RRD", c:18, s:1, exec: function(i) {
			var shl = self.readHL();
			var sa = self.readA();
			var smhl = self.mmu.read8(shl);
			var dmhl = ((sa & 0xf) << 4) | ((smhl >> 4) & 0xf);
			var r = (sa & 0xf0) | (smhl & 0xf);

			// cite:1 says C is changed, cite:3 says it is not changed
			//if (r & 0x80) { self.setFC(); } else { self.resetFC(); }
			if (r == 0) { self.setFZ(); } else { self.resetFZ(); }
			if (self.parity(r)) { self.setFP(); } else { self.resetFP(); }
			self.resetFH();
			self.resetFN();
			if (r & 0x08) { self.setF3(); } else { self.resetF3(); }
			if (r & 0x20) { self.setF5(); } else { self.resetF5(); }

			self.mmu.write8(shl, dmhl);
			self.writeA(r);
		} }

		// 8-bit ALU group with operand
		,rlc_rz: { disasm: "RLC %0", c:4, s:2, exec: function(i) {
			var s = i.operand_hook[0].read(i.operands[0]);
			var r = ((s << 1) | (s >> 7)) & 0xff;

			if (s & 0x80) { self.setFC(); } else { self.resetFC(); }
			if (r >= 0x80) { self.setFS(); } else { self.resetFS(); }
			if (r == 0) { self.setFZ(); } else { self.resetFZ(); }
			self.resetFH();
			if (self.parity(r)) { self.setFP(); } else { self.resetFP(); }
			self.resetFN();

			i.operand_hook[0].write(i.operands[0], r);
		} }
		,rrc_rz: { disasm: "RRC %0", c:4, s:2, exec: function(i) {
			var s = i.operand_hook[0].read(i.operands[0]);
			var r = ((s >> 1) | ( s << 7)) & 0xff;

			if (r & 0x80) { self.setFS(); } else { self.resetFS(); }
			if (r == 0) { self.setFZ(); } else { self.resetFZ(); }
			self.resetFH();
			if (self.parity(r)) { self.setFP(); } else { self.resetFP(); }
			self.resetFN();
			if (s & 0x01) { self.setFC(); } else { self.resetFC(); }

			i.operand_hook[0].write(i.operands[0], r);
		} }
		,rl_rz: { disasm: "RL %0", c:4, s:2, exec: function(i) {
			var s = i.operand_hook[0].read(i.operands[0]);
			var r = ((s << 1) & 0xff) | (self.getFC() ? 0x01 : 0x00);

			if (s & 0x80) { self.setFC(); } else { self.resetFC(); }
			if (r & 0x80) { self.setFS(); } else { self.resetFS(); }
			if (r == 0) { self.setFZ(); } else { self.resetFZ(); }
			self.resetFH();
			if (self.parity(r)) { self.setFP(); } else { self.resetFP(); }
			self.resetFN();

			i.operand_hook[0].write(i.operands[0], r);
		} }
		,rr_rz: { disasm: "RR %0", c:4, s:2, exec: function(i) {
			var s = i.operand_hook[0].read(i.operands[0]);
			var r = ((s >> 1) & 0xff) | (self.getFC() ? 0x80 : 0x00);

			if (s & 0x01) { self.setFC(); } else { self.resetFC(); }
			if (r & 0x80) { self.setFS(); } else { self.resetFS(); }
			if (r == 0) { self.setFZ(); } else { self.resetFZ(); }
			self.resetFH();
			if (self.parity(r)) { self.setFP(); } else { self.resetFP(); }
			self.resetFN();

			i.operand_hook[0].write(i.operands[0], r);
		} }
		,sla_rz: { disasm: "SLA %0", c:4, s:2, exec: function(i) {
			var s = i.operand_hook[0].read(i.operands[0]);
			var r = (s << 1) & 0xff;

			if (s & 0x80) { self.setFC(); } else { self.resetFC(); }
			if (r & 0x80) { self.setFS(); } else { self.resetFS(); }
			if (r == 0) { self.setFZ(); } else { self.resetFZ(); }
			self.resetFH();
			if (self.parity(r)) { self.setFP(); } else { self.resetFP(); }
			self.resetFN();

			i.operand_hook[0].write(i.operands[0], r);
		} }
		,sra_rz: { disasm: "SRA %0", c:4, s:2, exec: function(i) {
			var s = i.operand_hook[0].read(i.operands[0]);
			var r = ((s >> 1) & 0xff) | (s & 0x80);

			if (s & 0x01) { self.setFC(); } else { self.resetFC(); }
			if (r >= 0x80) { self.setFS(); } else { self.resetFS(); }
			if (r == 0) { self.setFZ(); } else { self.resetFZ(); }
			self.resetFH();
			if (self.parity(r)) { self.setFP(); } else { self.resetFP(); }
			self.resetFN();

			i.operand_hook[0].write(i.operands[0], r);
		} }
		,slia_rz: { disasm: "SLIA %0", c:4, s:2, exec: function(i) {
			var s = i.operand_hook[0].read(i.operands[0]);
			var r = ((s << 1) & 0xff) | 0x01;

			if (s & 0x80) { self.setFC(); } else { self.resetFC(); }
			if (r & 0x80) { self.setFS(); } else { self.resetFS(); }
			if (r == 0) { self.setFZ(); } else { self.resetFZ(); }
			self.resetFH();
			if (self.parity(r)) { self.setFP(); } else { self.resetFP(); }
			self.resetFN();

			i.operand_hook[0].write(i.operands[0], r);
		} }
		,srl_rz: { disasm: "SRL %0", c:4, s:2, exec: function(i) {
			var s = i.operand_hook[0].read(i.operands[0]);
			var r = (s >> 1) & 0xff;

			if (s & 0x01) { self.setFC(); } else { self.resetFC(); }
			if (r & 0x80) { self.setFS(); } else { self.resetFS(); }
			if (r == 0) { self.setFZ(); } else { self.resetFZ(); }
			self.resetFH();
			if (self.parity(r)) { self.setFP(); } else { self.resetFP(); }
			self.resetFN();

			i.operand_hook[0].write(i.operands[0], r);
		} }
		,daa: { disasm: "DAA", c:4, s:1, exec: function(i) {
			var tmp_i = 0;
			var tmp_c = self.getFC();
			var r = self.readA();

			if ((self.getFH()) || (r&0x0f) > 9) { tmp_i = 6; }
			if (tmp_c != 0 || r > 0x99) { tmp_i |= 0x60; }
			if (r > 0x99) { tmp_c = 1; }

			self.resetFC();
			if (self.getFN()) {
				r = self.base_sbc8(r, tmp_i);
			} else {
				r = self.base_adc8(r, tmp_i);
			}

			if (tmp_c) { self.setFC(); } else { self.resetFC(); }
			self.writeA(r);
			if (self.parity(r)) { self.setFP(); } else { self.resetFP(); }
		} }
		,cpl: { disasm: "CPL", c:4, s:1, exec: function(i) {
			var s = self.readA();
			var r = s ^ 0xff;

			if (s & 0x20) { self.setF5(); } else { self.resetF5(); }
			self.setFH();
			if (s & 0x08) { self.setF3(); } else { self.resetF3(); }
			self.setFN();

			self.writeA(r);
		} }
		,neg: { disasm: "NEG", c:4, s:1, exec: function(i) {
			var s = self.readA();
			var r = (256 - s) & 0xff;
			if (r >= 0x80) { self.setFS(); } else { self.resetFS(); }
			if (r == 0) { self.setFZ(); } else { self.resetFZ(); }
			if (s == 0x80) { self.setFV(); } else { self.resetFV(); }
			self.setFN();
			if (s != 0) { self.setFC(); } else { self.resetFC(); }
			self.writeA(r);
		} }
		,neg_ed: { disasm: "NEG", c:4, s:2, exec: function(i) {
			// same as NEG, but ED prefix
			var s = self.readA();
			var r = (256 - s) & 0xff;
			if (r >= 0x80) { self.setFS(); } else { self.resetFS(); }
			if (r == 0) { self.setFZ(); } else { self.resetFZ(); }
			if (s == 0x80) { self.setFV(); } else { self.resetFV(); }
			self.setFN();
			if (s != 0) { self.setFC(); } else { self.resetFC(); }
			self.writeA(r);
		} }
		,scf: { disasm: "SCF", c:4, s:1, exec: function(i) {
			if (self.readA() & 0x20) { self.setF5(); } else { self.resetF5(); }
			self.resetFH();
			if (self.readA() & 0x08) { self.setF3(); } else { self.resetF3(); }
			self.resetFN();
			self.setFC();
		} }
		,ccf: { disasm: "CCF", c:4, s:1, exec: function(i) {
			if (self.readA() & 0x20) { self.setF5(); } else { self.resetF5(); }
			if (self.readA() & 0x08) { self.setF3(); } else { self.resetF3(); }
			if (self.getFC()) {
				self.setFH();
				self.resetFC();
			} else {
				self.resetFH();
				self.setFC();
			}
			self.resetFN();
		} }
		,ex_af_af: { disasm: "EX AF,AF'", c:4, s:1, exec: function(i) {
			var af = self.readAF();
			var af2 = self.readAF2();
			self.writeAF(af2);
			self.writeAF2(af);
		} }
		,halt: { disasm: "HALT", c:4, s:1, exec: function(i) {
			self.writePC(self.readPC()-1);
		} }
		,add_rz: { disasm: "ADD %0", c:4, s:1, exec: function(i) {
			var d = self.readA();
			var s = i.operand_hook[0].read(i.operands[0]);
			self.resetFC();
			self.writeA(self.base_adc8(d, s));
			if (i.operands[0] == 6) { self.clocks += 3; } // (HL)
		} }
		,add_ib: { disasm: "ADD %ib", c:4, s:2, exec: function(i) {
			var d = self.readA();
			var s = self.immediate8();
			self.resetFC();
			self.writeA(self.base_adc8(d, s));
		} }
		,adc_rz: { disasm: "ADC %0", c:4, s:1, exec: function(i) {
			var d = self.readA();
			var s = i.operand_hook[0].read(i.operands[0]);
			self.writeA(self.base_adc8(d, s));
			if (i.operands[0] == 6) { self.clocks += 3; } // (HL)
		} }
		,adc_ib: { disasm: "ADC %ib", c:4, s:2, exec: function(i) {
			var d = self.readA();
			var s = self.immediate8();
			self.writeA(self.base_adc8(d, s));
		} }
		,sub_rz: { disasm: "SUB %0", c:4, s:1, exec: function(i) {
			var d = self.readA();
			var s = i.operand_hook[0].read(i.operands[0]);
			self.resetFC();
			self.writeA(self.base_sbc8(d, s));
			if (i.operands[0] == 6) { self.clocks += 3; } // (HL)
		} }
		,sub_ib: { disasm: "SUB %ib", c:4, s:2, exec: function(i) {
			var d = self.readA();
			var s = self.immediate8();
			self.resetFC();
			self.writeA(self.base_sbc8(d, s));
		} }
		,sbc_rz: { disasm: "SBC %0", c:4, s:1, exec: function(i) {
			var d = self.readA();
			var s = i.operand_hook[0].read(i.operands[0]);
			self.writeA(self.base_sbc8(d, s));
			if (i.operands[0] == 6) { self.clocks += 3; } // (HL)
		} }
		,sbc_ib: { disasm: "SBC %ib", c:4, s:2, exec: function(i) {
			var d = self.readA();
			var s = self.immediate8();
			self.writeA(self.base_sbc8(d, s));
		} }
		,and_rz: { disasm: "AND %0", c:4, s:1, exec: function(i) {
			var d = self.readA();
			var s = i.operand_hook[0].read(i.operands[0]);
			self.writeA(self.base_and8(d, s));
			if (i.operands[0] == 6) { self.clocks += 3; } // (HL)
		} }
		,and_ib: { disasm: "AND %ib", c:4, s:2, exec: function(i) {
			var d = self.readA();
			var s = self.immediate8();
			self.writeA(self.base_and8(d, s));
		} }
		,or_rz: { disasm: "OR %0", c:4, s:1, exec: function(i) {
			var d = self.readA();
			var s = i.operand_hook[0].read(i.operands[0]);
			self.writeA(self.base_or8(d, s));
			if (i.operands[0] == 6) { self.clocks += 3; } // (HL)
		} }
		,or_ib: { disasm: "OR %ib", c:4, s:2, exec: function(i) {
			var d = self.readA();
			var s = self.immediate8();
			self.writeA(self.base_or8(d, s));
		} }
		,xor_rz: { disasm: "XOR %0", c:4, s:1, exec: function(i) {
			var d = self.readA();
			var s = i.operand_hook[0].read(i.operands[0]);
			self.writeA(self.base_xor8(d, s));
			if (i.operands[0] == 6) { self.clocks += 3; } // (HL)
		} }
		,xor_ib: { disasm: "XOR %ib", c:4, s:2, exec: function(i) {
			var d = self.readA();
			var s = self.immediate8();
			self.writeA(self.base_xor8(d, s));
		} }
		,cp_rz: { disasm: "CP %0", c:4, s:1, exec: function(i) {
			var d = self.readA();
			var s = i.operand_hook[0].read(i.operands[0]);
			self.base_cp8(d, s);
			if (i.operands[0] == 6) { self.clocks += 3; } // (HL)
		} }
		,cp_ib: { disasm: "CP %ib", c:4, s:2, exec: function(i) {
			var d = self.readA();
			var s = self.immediate8();
			self.base_cp8(d, s);
		} }
		,bit: { disasm: "BIT %0,%1", c:16, s:2, exec: function(i) {
			var n = i.operands[0];
			var n_mask = 1 << n;
			var s = i.operand_hook[1].read(i.operands[1]);

			if (typeof(g_foo) != 'undefined') {
				console.log(i, n, n_mask, s);
			}

			if (s & (1 << n) & 0x80) { self.setFS(); } else { self.resetFS(); }
			if (s & (1 << n)) {
				self.resetFZ();
				self.resetFP();
			} else {
				self.setFZ();
				self.setFP();
			}

			if (s & 0x20) { self.setF5(); } else { self.resetF5(); }
			if (s & 0x08) { self.setF3(); } else { self.resetF3(); }

/*
			if (i.operands[1] == 6) {

			} else {
				if (self.readMEMPTR() & 0x2000) { self.setF5(); } else { self.resetF5(); }
				if (self.readMEMPTR() & 0x0800) { self.setF3(); } else { self.resetF3(); }
			}
*/
			self.setFH();
			self.resetFN();
		} }
		,res: {	disasm: "RES %0,%1", c:4, s:2, exec: function(i) {
			var v = i.operand_hook[1].read(i.operands[1]);
			v &= (1 << i.operands[0]) ^ 0xff;
			i.operand_hook[1].write(i.operands[1], v);
		} }
		,set: {	disasm: "SET %0,%1", c:4, s:2, exec: function(i) {
			var n = i.operands[0];
			var n_mask = (1 << n) & 0xff;
			var s = i.operand_hook[1].read(i.operands[1]);
			var r = s | n_mask;
			i.operand_hook[1].write(i.operands[1], r);
		} }
		,add_hl_rp: { disasm: "ADD HL,%0", c:11, s:1, exec: function(i) {
			var d = self.readHL();
			var s = i.operand_hook[0].read(i.operands[0]);
			var r = d + s;
			if ((s & 0x07ff) + (d & 0x07ff) >= 0x0800) { self.setFH(); } else { self.resetFH(); }
			self.resetFN();
			if (r >= 0x10000) { self.setFC(); } else { self.resetFC(); }
			self.writeHL(r & 0xffff);
		} }
		,add_ix_rp: { disasm: "ADD IX,%0", c:11, s:1, exec: function(i) {
			var s = i.operand_hook[0].read(i.operands[0]);
			var d = self.readIX();
			var r = s + d;
			self.writeMEMPTR(d + 1);
			self.resetFN();
			if (r >= 0x10000) { self.setFC(); } else { self.resetFC(); }
			self.writeIX(r);
		} }
		,add_iy_rp: { disasm: "ADD IY,%0", c:11, s:1, exec: function(i) {
			var s = i.operand_hook[0].read(i.operands[0]);
			var d = self.readIX();
			var r = s + d;
			self.writeMEMPTR(d + 1);
			self.resetFN();
			if (r >= 0x10000) { self.setFC(); } else { self.resetFC(); }
			self.writeIY(r);
		} }

		// call stack operations
		,rst: { disasm: "RST %0", c:17, s:1, exec: function(i) {
			self.writeSP(self.readSP()-2);
			var ret_address = self.readPC() + 1;
			self.mmu.write8(self.readSP() + 1, (ret_address >> 8) & 0xff);
			self.mmu.write8(self.readSP(), ret_address & 0xff);
			self.writePC(i.operands[0]*8 - 1);
			self.writeMEMPTR(i.operands[0]*8);
		} }
		,call: { disasm: "CALL %iw", c:17, s:3, exec: function(i) {
			var target = self.immediate16();
			var ret_address = self.readPC() + 3;
			self.writeSP(self.readSP() - 2);
			// written high-byte first -
			// visible to hardware but not software
			self.mmu.write8(self.readSP() + 1, (ret_address >> 8) & 0xff);
			self.mmu.write8(self.readSP(), ret_address & 0xff);
			self.writePC(target - 3);
		} }
		,call_ccy: { disasm: "CALL %0,%iw", c:17, s:3, exec: function(i) {
			var target = self.immediate16();
			self.writeMEMPTR(target);
			if (self.testCondition(i.operands[0])) {
				var ret_address = self.readPC() + 3;
				self.writeSP(self.readSP() - 2);
				// written high-byte first -
				// visible to hardware but not software
				self.mmu.write8(self.readSP() + 1, (ret_address >> 8) & 0xff);
				self.mmu.write8(self.readSP(), ret_address & 0xff);
				self.writePC(target - 3);
			}
		} }
		,ret: { disasm: "RET", c:10, s:1, exec: function(i) {
			self.writePC(self.mmu.read16(self.readSP()) - 1);
			self.writeSP(self.readSP() + 2);
		} }

		// only difference between RETI/RETN is opcode, for Z80 PIO chaining
		,retn: { disasm: "RETN", c:10, s:2, exec: function(i) {
			self.r.IFF1 = self.r.IFF2;
			self.writePC(self.mmu.read16(self.readSP()) - 2);
			self.writeSP(self.readSP() + 2);
		} }
		,reti: { disasm: "RETI", c:10, s:2, exec: function(i) {
			self.r.IFF1 = self.r.IFF2;
			self.writePC(self.mmu.read16(self.readSP()) - 2);
			self.writeSP(self.readSP() + 2);
		} }
		,ret_ccy: { disasm: "RET %0", c:5, s:1, exec: function(i) {
			if (self.testCondition(i.operands[0])) {
				var target = self.mmu.read16(self.readSP());
				self.writePC(target - 1 - self.prefix_bytes);
				self.writeSP(self.readSP() + 2);
				self.clocks += 6;
			}
		} }

		// data stack operations
		,push: { disasm: "PUSH %0", c:11, s:1, exec: function(i) {
			var r = i.operand_hook[0].read(i.operands[0]);
			// high-byte is written first
			self.mmu.write8(self.readSP()-1, r >> 8);
			self.mmu.write8(self.readSP()-2, r & 0xff);
			self.writeSP(self.readSP()-2);
		} }
		,pop: { disasm: "POP %0", c:10, s:1, exec: function(i) {
			i.operand_hook[0].write(i.operands[0], self.mmu.read16(self.readSP()));
			self.writeSP(self.readSP()+2);
		} }
		,push_af: { disasm: "PUSH AF", c:11, s:1, exec: function(i) {
			// high-byte is written first
			self.mmu.write8(self.readSP()-1, self.readAF() >> 8);
			self.mmu.write8(self.readSP()-2, self.readAF() & 0xff);
			self.writeSP(self.readSP()-2);
		} }
		,pop_af: { disasm: "POP AF", c:10, s:1, exec: function(i) {
			self.writeAF(self.mmu.read16(self.readSP()));
			self.writeSP(self.readSP()+2);
		} }

		// port IO
		,in_a_ib: { disasm: "IN A,(%ib)", c:12, s:2, exec: function(i) {
			var port = (self.readA() << 8) | (self.immediate8());
			var r = self.io.read(port);
			self.writeA(r);
		} }
		,in_ry_bc: { disasm: "IN %0,(C)", c:12, s:2, exec: function(i) {
			var port = self.readBC();
			var r = self.io.read(port);

			// don't write to (HL)
			if (i.operands[0] != 6) {
				i.operand_hook[0].write(i.operands[0], r);
			}

			self.writeMEMPTR(self.readBC() + 1);

			if (r & 0x80) { self.setFS(); } else { self.resetFS(); }
			if (r == 0) { self.setFZ(); } else { self.resetFZ(); }
			if (r & 0x20) { self.setF5(); } else { self.resetF5(); }
			self.resetFH();
			if (r & 0x08) { self.setF3(); } else { self.resetF3(); }
			if (self.parity(r)) { self.setFP(); } else { self.resetFP(); }
			self.resetFN();
		} }

		,out_ib_a: { disasm: "OUT (%ib),A", c:12, s:2, exec: function(i) {
			var port = (self.readA() << 8) | self.immediate8();
			var data = self.readA();
			self.io.write(port, data);
		} }
		,out_bc_ry: { disasm: "OUT (C),%0", c:12, s:2, exec: function(i) {
			var port = self.readBC();
			var data = 0;
			// don't read from (HL)
			if (i.operands[0] != 6) {
				data = i.operand_hook[0].read(i.operands[0]);
			}
			self.io.write(port, data);
		} }
		,exx: { disasm: "EXX", c:4, s:1, exec: function(i) {
			var temp;

			// swap BC and BC'
			temp = self.readBC();
			self.writeBC(self.readBC2());
			self.writeBC2(temp);

			// swap DE and DE'
			temp = self.readDE();
			self.writeDE(self.readDE2());
			self.writeDE2(temp);

			// swap HL and HL'
			temp = self.readHL();
			self.writeHL(self.readHL2());
			self.writeHL2(temp);
		} }

		,ex_msp_hl: { disasm: "EX (SP),HL", c:19, s:1, exec: function(i) {
			var msp = self.mmu.read16(self.readSP());
			var r = self.readHL();
			self.mmu.write16(self.readSP(), r);
			self.writeHL(msp);
			self.writeMEMPTR(r);
		} }
		,ex_msp_ix: { disasm: "EX (SP),IX", c:19, s:1, exec: function(i) {
			var msp = self.mmu.read16(self.readSP());
			var r = self.readIX();
			self.mmu.write16(self.readSP(), r);
			self.writeIX(msp);
			self.writeMEMPTR(r);
		} }
		,ex_msp_iy: { disasm: "EX (SP),IY", c:19, s:1, exec: function(i) {
			var msp = self.mmu.read16(self.readSP());
			var r = self.readIY();
			self.mmu.write16(self.readSP(), r);
			self.writeIY(msp);
			self.writeMEMPTR(r);
		} }

		,ex_de_hl: { disasm: "EX DE,HL", c:4, s:1, exec: function(i) {
			var de = self.readDE();
			var hl = self.readHL();
			self.writeDE(hl);
			self.writeHL(de);
		} }

		,di: { disasm: "DI", c:4, s:1, exec: function(i) {
			self.writeIFF1(0);
			self.writeIFF2(0);
		} }
		,ei: { disasm: "EI", c:4, s:1, exec: function(i) {
			// IFF1/2 are not immediately reset, but delayed until after
			// execution of the _next_ instruction, to allow interrupt
			// routines which end with "EI ; RETI" to process the RETI
			// before interrupts are handled again, which prevents
			// a posibility of filling the stack.
			// cite:4

			self.request_ei = 1;
		} }

		// 16-bit ADC/SBC
		,adc_hl_rp: { disasm: "ADC HL,%0", c:15, s:2, exec: function(i) {
			var d = self.readHL();
			var s = i.operand_hook[0].read(i.operands[0]);
			var c = !!self.getFC();
			var n = s + d + c;
			var r = n & 0xffff;

			self.writeMEMPTR((d + 1) & 0xffff);

			self.resetFS();
			if (r == 0) { self.setFZ(); } else { self.resetFZ(); }
			if ((r >> 8) & 0x20) { self.setF5(); } else { self.resetF5(); }
			if ((s & 0x0fff) + (d & 0x0fff) + c >= 0x1000) { self.setFH(); } else { self.resetFH(); }
			if ((r >> 8) & 0x08) { self.setF3(); } else { self.resetF3(); }
			if ((s ^ ((~d) & 0xffff)) & (s ^ n) & 0x8000) { self.setFV(); } else { self.resetFV(); }
			self.resetFN();
			if (n > 0xffff) { self.setFC(); } else { self.resetFC(); }

			self.writeHL(r);
		} }
		,sbc_hl_rp: { disasm: "SBC HL,%0", c:15, s:2, exec: function(i) {
			var d = self.readHL();
			var s = i.operand_hook[0].read(i.operands[0]);
			var r = self.base_sbc8(d & 0xff, s & 0xff);
			r |= (self.base_sbc8((d >> 8) & 0xff, (s >> 8) & 0xff) << 8) & 0xffff;
			if (r == 0) { self.setFZ(); } else { self.resetFZ(); }
			self.writeHL(r);
		} }

		// interrupt mode
		,im_0: { disasm: "IM 0", c:4, s:2, exec: function(i) {
			self.writeIM(0);
		} }
		,im_1: { disasm: "IM 1", c:4, s:2, exec: function(i) {
			self.writeIM(1);
		} }
		,im_2: { disasm: "IM 2", c:4, s:2, exec: function(i) {
			self.writeIM(2);
		} }

		// block increment
		,ldi: { disasm: "LDI", c:16, s:2, exec: function(i) {
			var value = self.mmu.read8(self.readHL());
			self.mmu.write8(self.readDE(), value);
			self.writeDE(self.readDE() + 1);
			self.writeHL(self.readHL() + 1);
			self.writeBC(self.readBC() - 1);
			// cite:3
			if ((value + self.readA()) & 0x20) { self.setF5(); } else { self.resetF5(); }
			self.resetFH();
			// cite:3
			if ((value + self.readA()) & 0x08) { self.setF3(); } else { self.resetF3(); }
			if (self.readBC() != 0) { self.setFV(); } else { self.resetFV(); }
			self.resetFN();
		} }
		,cpi: { disasm: "CPI", c:16, s:2, exec: function(i) {
			if (self.read(BC) != 0) { self.setFV(); } else { self.resetFV(); }
			self.break();
		} }
		,ini: { disasm: "INI", c:16, s:2, exec: function(i) { self.break(); } }
		,outi: { disasm: "OUTI", c:16, s:2, exec: function(i) { self.break(); } }

		// block decrement
		,ldd: { disasm: "LDD", c:16, s:2, exec: function(i) {
			var value = self.mmu.read8(self.readHL());
			self.mmu.write8(self.readDE(), value);
			self.writeDE(self.readDE() - 1);
			self.writeHL(self.readHL() - 1);
			self.writeBC(self.readBC() - 1);
		} }
		,cpd: { disasm: "CPD", c:16, s:2, exec: function(i) { self.break(); } }
		,ind: { disasm: "IND", c:16, s:2, exec: function(i) { self.break(); } }
		,outd: { disasm: "OUTD", c:16, s:2, exec: function(i) { self.break(); } }

		// block repeat increment
		,ldir: { disasm: "LDIR", c:5, s:2, exec: function(i) {
			self.instructions.ldi.exec(i);
			if (self.readBC() != 0) {
				self.writePC(self.readPC() - 2);
			}
		} }
		,cpir: { disasm: "CPIR", c:5, s:2, exec: function(i) {
			self.instructions.cpi.exec(i);
			if (self.readBC() != 0) {
				self.writePC(self.readPC() - 2);
			}
		} }
		,inir: { disasm: "INIR", c:5, s:2, exec: function(i) {
			self.instructions.ini.exec(i);
			if (self.readBC() != 0) {
				self.writePC(self.readPC() - 2);
			}
		} }
		,otir: { disasm: "OTIR", c:5, s:2, exec: function(i) {
			self.instructions.outi.exec(i);
			if (self.readBC() != 0) {
				self.writePC(self.readPC() - 2);
			}
		} }

		// block repeat decrement
		,lddr: { disasm: "LDDR", c:5, s:2, exec: function(i) {
			self.instructions.ldd.exec(i);
			if (self.readBC() != 0) {
				self.writePC(self.readPC() - 2);
			}
		} }
		,cpdr: { disasm: "CPDR", c:5, s:2, exec: function(i) {
			self.instructions.cpd.exec(i);
			if (self.readBC() != 0) {
				self.writePC(self.readPC() - 2);
			}
		} }
		,indr: { disasm: "INDR", c:5, s:2, exec: function(i) {
			self.instructions.ind.exec(i);
			if (self.readBC() != 0) {
				self.writePC(self.readPC() - 2);
			}
		} }
		,otdr: { disasm: "OTDR", c:5, s:2, exec: function(i) {
			self.instructions.outd.exec(i);
			if (self.readBC() != 0) {
				self.writePC(self.readPC() - 2);
			}
		} }
	};

	self.i = self.instructions;

	self.instruction_templates = {
		main:[
			{ o:0x00, p:[], i:self.i.nop }

			,{ o:0x01, p:[this.operand_rp], i:self.i.ld_rp_iw  }
			,{ o:0x02, p:[this.operand_rp], i:self.i.ld_mrp_a  }
			,{ o:0x03, p:[this.operand_rp], i:self.i.inc_rp    }
			,{ o:0x04, p:[this.operand_ry], i:self.i.inc_ry    }
			,{ o:0x05, p:[this.operand_ry], i:self.i.dec_ry    }
			,{ o:0x06, p:[this.operand_ry], i:self.i.ld_ry_ib  }
			,{ o:0x09, p:[this.operand_rp], i:self.i.add_hl_rp }
			,{ o:0x0b, p:[this.operand_rp], i:self.i.dec_rp    }
			,{ o:0x20, p:[this.operand_ccy4], i:self.i.jr_ccy4 }
			,{ o:0x40, p:[this.operand_ry, this.operand_rz], i:self.i.ld_ry_rz }

			,{ o:0x07, p:[], i:self.i.rlca     }
			,{ o:0x08, p:[], i:self.i.ex_af_af }
			,{ o:0x0a, p:[], i:self.i.ld_a_mbc }
			,{ o:0x0f, p:[], i:self.i.rrca     }
			,{ o:0x10, p:[], i:self.i.djnz     }
			,{ o:0x17, p:[], i:self.i.rla      }
			,{ o:0x18, p:[], i:self.i.jr       }
			,{ o:0x1a, p:[], i:self.i.ld_a_mde }
			,{ o:0x1f, p:[], i:self.i.rra      }
			,{ o:0x22, p:[], i:self.i.ld_mi_hl }
			,{ o:0x27, p:[], i:self.i.daa,     }
			,{ o:0x2a, p:[], i:self.i.ld_hl_mi }
			,{ o:0x2f, p:[], i:self.i.cpl      }
			,{ o:0x32, p:[], i:self.i.ld_mi_a  }
			,{ o:0x37, p:[], i:self.i.scf      }
			,{ o:0x3a, p:[], i:self.i.ld_a_mi  }
			,{ o:0x3e, p:[], i:self.i.ld_a_ib  }
			,{ o:0x3f, p:[], i:self.i.ccf      }
			,{ o:0x76, p:[], i:self.i.halt     }

			// ALU with byte regs/(HL)
			,{ o:0x80, p:[this.operand_rz], i:self.i.add_rz }
			,{ o:0x88, p:[this.operand_rz], i:self.i.adc_rz }
			,{ o:0x90, p:[this.operand_rz], i:self.i.sub_rz }
			,{ o:0x98, p:[this.operand_rz], i:self.i.sbc_rz }
			,{ o:0xa0, p:[this.operand_rz], i:self.i.and_rz }
			,{ o:0xa8, p:[this.operand_rz], i:self.i.xor_rz }
			,{ o:0xb0, p:[this.operand_rz], i:self.i.or_rz  }
			,{ o:0xb8, p:[this.operand_rz], i:self.i.cp_rz  }

			// stack/call/jump
			,{ o:0xc0, p:[this.operand_ccy], i:self.i.ret_ccy  }
			,{ o:0xc1, p:[this.operand_rp2], i:self.i.pop      }
			,{ o:0xc2, p:[this.operand_ccy], i:self.i.jp_ccy   }
			,{ o:0xc3, p:[],                 i:self.i.jp       }
			,{ o:0xc4, p:[this.operand_ccy], i:self.i.call_ccy }
			,{ o:0xc5, p:[this.operand_rp2], i:self.i.push     }
			,{ o:0xc7, p:[this.operand_rst], i:self.i.rst      }
			,{ o:0xc9, p:[],                 i:self.i.ret      }
			,{ o:0xcd, p:[],                 i:self.i.call     }

			,{ o:0xc6, p:[], i:self.i.add_ib    }
			,{ o:0xce, p:[], i:self.i.adc_ib    }
			,{ o:0xd3, p:[], i:self.i.out_ib_a  }
			,{ o:0xd6, p:[], i:self.i.sub_ib    }
			,{ o:0xd9, p:[], i:self.i.exx       }
			,{ o:0xdb, p:[], i:self.i.in_a_ib   }
			,{ o:0xde, p:[], i:self.i.sbc_ib    }
			,{ o:0xe3, p:[], i:self.i.ex_msp_hl }
			,{ o:0xe6, p:[], i:self.i.and_ib    }
			,{ o:0xe9, p:[], i:self.i.jp_hl     }
			,{ o:0xeb, p:[], i:self.i.ex_de_hl  }
			,{ o:0xee, p:[], i:self.i.xor_ib    }
			,{ o:0xf1, p:[], i:self.i.pop_af    }
			,{ o:0xf3, p:[], i:self.i.di        }
			,{ o:0xf5, p:[], i:self.i.push_af   }
			,{ o:0xf6, p:[], i:self.i.or_ib     }
			,{ o:0xf9, p:[], i:self.i.ld_sp_hl  }
			,{ o:0xfb, p:[], i:self.i.ei        }
			,{ o:0xfe, p:[], i:self.i.cp_ib     }

			,{ o:0xcb, p:[], i:self.i.cb_prefix }
			,{ o:0xed, p:[], i:self.i.ed_prefix }
			,{ o:0xdd, p:[], i:self.i.dd_prefix }
			,{ o:0xfd, p:[], i:self.i.fd_prefix }
		]
		,cb:[
			 { o:0x00, p:[this.operand_rz], i:self.i.rlc_rz }
			,{ o:0x08, p:[this.operand_rz], i:self.i.rrc_rz }
			,{ o:0x10, p:[this.operand_rz], i:self.i.rl_rz }
			,{ o:0x18, p:[this.operand_rz], i:self.i.rr_rz }
			,{ o:0x20, p:[this.operand_rz], i:self.i.sla_rz }
			,{ o:0x28, p:[this.operand_rz], i:self.i.sra_rz }
			,{ o:0x30, p:[this.operand_rz], i:self.i.slia_rz }
			,{ o:0x38, p:[this.operand_rz], i:self.i.srl_rz }

			// operand_bit specifies bit index which is common to BIT/RES/SET
			,{ o:0x40, p:[this.operand_bit, this.operand_rz], i:self.i.bit }
			,{ o:0x80, p:[this.operand_bit, this.operand_rz], i:self.i.res }
			,{ o:0xc0, p:[this.operand_bit, this.operand_rz], i:self.i.set }
		]
		,ed:[
			{ o:0x00, p:[this.operand_all], i:self.i.ed_unimplemented }

			,{ o:0x40, p:[this.operand_ry], i:self.i.in_ry_bc }
			,{ o:0x41, p:[this.operand_ry], i:self.i.out_bc_ry }
			,{ o:0x42, p:[this.operand_rp], i:self.i.sbc_hl_rp }
			,{ o:0x43, p:[this.operand_rp], i:self.i.ld_mi_rp }
			,{ o:0x4A, p:[this.operand_rp], i:self.i.adc_hl_rp }
			,{ o:0x4B, p:[this.operand_rp], i:self.i.ld_rp_mi }
			,{ o:0x44, p:[this.operand_ry], i:self.i.neg_ed } // operand is ignored
			,{ o:0x45, p:[this.operand_rp], i:self.i.retn } // operand is ignored
			,{ o:0x4D, p:[this.operand_rp], i:self.i.reti } // operand is ignored

			,{ o:0x47, p:[], i:self.i.ld_i_a }
			,{ o:0x4f, p:[], i:self.i.ld_r_a }
			,{ o:0x57, p:[], i:self.i.ld_a_i }
			,{ o:0x4f, p:[], i:self.i.ld_a_r }

			// decimal rotates
			,{ o:0x67, p:[], i:self.i.rrd }
			,{ o:0x6f, p:[], i:self.i.rld }

			// interrupt mode (and duplicates)
			,{ o:0x4E, p:[], i:self.i.im_0 }
			,{ o:0x56, p:[], i:self.i.im_1 }
			,{ o:0x5E, p:[], i:self.i.im_2 }
			,{ o:0x6E, p:[], i:self.i.im_0 }
			,{ o:0x76, p:[], i:self.i.im_1 }
			,{ o:0x7E, p:[], i:self.i.im_2 }

			// transfer increment
			,{ o:0xA0, p:[], i:self.i.ldi  }
			,{ o:0xA1, p:[], i:self.i.cpi  }
			,{ o:0xA2, p:[], i:self.i.ini  }
			,{ o:0xA3, p:[], i:self.i.outi }

			// transfer decrement
			,{ o:0xA8, p:[], i:self.i.ldd  }
			,{ o:0xA9, p:[], i:self.i.cpd  }
			,{ o:0xAA, p:[], i:self.i.ind  }
			,{ o:0xAB, p:[], i:self.i.outd }

			// transfer increment repeat
			,{ o:0xB0, p:[], i:self.i.ldir }
			,{ o:0xB1, p:[], i:self.i.cpir }
			,{ o:0xB2, p:[], i:self.i.inir }
			,{ o:0xB3, p:[], i:self.i.otir }

			// transfer decrement repeat
			,{ o:0xB8, p:[], i:self.i.lddr }
			,{ o:0xB9, p:[], i:self.i.cpdr }
			,{ o:0xBA, p:[], i:self.i.indr }
			,{ o:0xBB, p:[], i:self.i.otdr }
		]
		,dd:[
			{ o:0x00, p:[this.operand_all], i:self.i.dd_fallthrough }
			,{ o:0x01, p:[this.operand_ddrp], i:self.i.ld_rp_iw  }
			,{ o:0x02, p:[this.operand_ddrp], i:self.i.ld_mrp_a  }
			,{ o:0x03, p:[this.operand_ddrp], i:self.i.inc_rp    }
			,{ o:0x04, p:[this.operand_ddry], i:self.i.inc_ry    }
			,{ o:0x05, p:[this.operand_ddry], i:self.i.dec_ry    }
			,{ o:0x06, p:[this.operand_ddry], i:self.i.ld_ry_ib  }
			,{ o:0x09, p:[this.operand_ddrp], i:self.i.add_ix_rp }
			,{ o:0x0b, p:[this.operand_ddrp], i:self.i.dec_rp    }
			,{ o:0x22, p:[], i:self.i.ld_mi_ix  }
			,{ o:0x2a, p:[], i:self.i.ld_ix_mi  }
			,{ o:0x36, p:[], i:self.i.ld_mix_ib }

			// this is wrong for H/L/(IY+dd) on either side, fix with following 3 rules.
			,{ o:0x40, p:[this.operand_ddry, this.operand_ddrz], i:self.i.ld_ry_rz }
			// fix LD H/L,(IX+dd)
			,{ o:0x46, p:[this.operand_ry], i:self.i.ld_ry_mix }
			// fix LD (IX+dd),H/L
			,{ o:0x70, p:[this.operand_rz], i:self.i.ld_mix_rz }
			// fix (IX+dd),(IX+dd)
			,{ o:0x76, p:[], i:self.i.halt }

			,{ o:0xcb, p:[], i:self.i.ddcb_prefix }

			// ALU with byte regs/(HL)
			,{ o:0x80, p:[this.operand_ddrz], i:self.i.add_rz }
			,{ o:0x88, p:[this.operand_ddrz], i:self.i.adc_rz }
			,{ o:0x90, p:[this.operand_ddrz], i:self.i.sub_rz }
			,{ o:0x98, p:[this.operand_ddrz], i:self.i.sbc_rz }
			,{ o:0xa0, p:[this.operand_ddrz], i:self.i.and_rz }
			,{ o:0xa8, p:[this.operand_ddrz], i:self.i.xor_rz }
			,{ o:0xb0, p:[this.operand_ddrz], i:self.i.or_rz  }
			,{ o:0xb8, p:[this.operand_ddrz], i:self.i.cp_rz  }

			// stack/call/jump
			,{ o:0xc1, p:[this.operand_ddrp2], i:self.i.pop    }
			,{ o:0xc5, p:[this.operand_ddrp2], i:self.i.push   }

			,{ o:0xe3, p:[], i:self.i.ex_msp_ix }
			,{ o:0xe9, p:[], i:self.i.jp_ix     }
			,{ o:0xf9, p:[], i:self.i.ld_sp_ix  }
		]
		,fd:[ // copy of dd: templates, but with iy/fd instead of ix/dd
			{ o:0x00, p:[this.operand_all], i:self.i.fd_fallthrough }
			,{ o:0x01, p:[this.operand_fdrp], i:self.i.ld_rp_iw  }
			,{ o:0x02, p:[this.operand_fdrp], i:self.i.ld_mrp_a  }
			,{ o:0x03, p:[this.operand_fdrp], i:self.i.inc_rp    }
			,{ o:0x04, p:[this.operand_fdry], i:self.i.inc_ry    }
			,{ o:0x05, p:[this.operand_fdry], i:self.i.dec_ry    }
			,{ o:0x06, p:[this.operand_fdry], i:self.i.ld_ry_ib  }
			,{ o:0x09, p:[this.operand_fdrp], i:self.i.add_iy_rp }
			,{ o:0x0b, p:[this.operand_fdrp], i:self.i.dec_rp    }
			,{ o:0x22, p:[], i:self.i.ld_mi_iy  }
			,{ o:0x2a, p:[], i:self.i.ld_iy_mi  }
			,{ o:0x36, p:[], i:self.i.ld_miy_ib }

			// this is wrong for H/L/(IY+dd) on either side, fix with following 3 rules.
			,{ o:0x40, p:[this.operand_fdry, this.operand_fdrz], i:self.i.ld_ry_rz }
			// fix LD H/L,(IY+dd)
			,{ o:0x46, p:[this.operand_ry], i:self.i.ld_ry_miy }
			// fix LD (IY+dd),H/L
			,{ o:0x70, p:[this.operand_rz], i:self.i.ld_miy_rz }
			// fix (IY+dd),(IY+dd)
			,{ o:0x76, p:[], i:self.i.halt }

			,{ o:0xcb, p:[], i:self.i.fdcb_prefix }

			// ALU with byte regs/(HL)
			,{ o:0x80, p:[this.operand_fdrz], i:self.i.add_rz }
			,{ o:0x88, p:[this.operand_fdrz], i:self.i.adc_rz }
			,{ o:0x90, p:[this.operand_fdrz], i:self.i.sub_rz }
			,{ o:0x98, p:[this.operand_fdrz], i:self.i.sbc_rz }
			,{ o:0xa0, p:[this.operand_fdrz], i:self.i.and_rz }
			,{ o:0xa8, p:[this.operand_fdrz], i:self.i.xor_rz }
			,{ o:0xb0, p:[this.operand_fdrz], i:self.i.or_rz  }
			,{ o:0xb8, p:[this.operand_fdrz], i:self.i.cp_rz  }

			// stack/call/jump
			,{ o:0xc1, p:[this.operand_fdrp2], i:self.i.pop    }
			,{ o:0xc5, p:[this.operand_fdrp2], i:self.i.push   }

			,{ o:0xe3, p:[], i:self.i.ex_msp_iy }
			,{ o:0xe9, p:[], i:self.i.jp_iy     }
			,{ o:0xf9, p:[], i:self.i.ld_sp_iy  }
		]
		,ddcb:[
			 { o:0x00, p:[this.operand_ddcbrz], i:self.i.rlc_rz  }
			,{ o:0x08, p:[this.operand_ddcbrz], i:self.i.rrc_rz  }
			,{ o:0x10, p:[this.operand_ddcbrz], i:self.i.rl_rz   }
			,{ o:0x18, p:[this.operand_ddcbrz], i:self.i.rr_rz   }
			,{ o:0x20, p:[this.operand_ddcbrz], i:self.i.sla_rz  }
			,{ o:0x28, p:[this.operand_ddcbrz], i:self.i.sra_rz  }
			,{ o:0x30, p:[this.operand_ddcbrz], i:self.i.slia_rz }
			,{ o:0x38, p:[this.operand_ddcbrz], i:self.i.srl_rz  }
			,{ o:0x40, p:[this.operand_bit, this.operand_ddcbrz], i:self.i.bit }
			,{ o:0x80, p:[this.operand_bit, this.operand_ddcbrz], i:self.i.res }
			,{ o:0xc0, p:[this.operand_bit, this.operand_ddcbrz], i:self.i.set }
		]
		,fdcb:[ // copy of dd: templates, but with iy/fd instead of ix/dd
			 { o:0x00, p:[this.operand_fdcbrz], i:self.i.rlc_rz  }
			,{ o:0x08, p:[this.operand_fdcbrz], i:self.i.rrc_rz  }
			,{ o:0x10, p:[this.operand_fdcbrz], i:self.i.rl_rz   }
			,{ o:0x18, p:[this.operand_fdcbrz], i:self.i.rr_rz   }
			,{ o:0x20, p:[this.operand_fdcbrz], i:self.i.sla_rz  }
			,{ o:0x28, p:[this.operand_fdcbrz], i:self.i.sra_rz  }
			,{ o:0x30, p:[this.operand_fdcbrz], i:self.i.slia_rz }
			,{ o:0x38, p:[this.operand_fdcbrz], i:self.i.srl_rz  }
			,{ o:0x40, p:[this.operand_bit, this.operand_fdcbrz], i:self.i.bit }
			,{ o:0x80, p:[this.operand_bit, this.operand_fdcbrz], i:self.i.res }
			,{ o:0xc0, p:[this.operand_bit, this.operand_fdcbrz], i:self.i.set }
		]
	};

	return self;
}
Z80.prototype = {
	create: function()
	{
		var func = "Z80.create";
		var self = this;

		self.opcode_descriptions = [];

		for (group in self.instruction_templates) {
			console.log(func + ": creating opcode group '" + group + "'");
			self.opcode_descriptions[group] = self.generateOpcodeDescriptions(
				self.instruction_templates[group]
			);
		}
	}
	,setDebug: function(value) {
		this.debug = value;
	}
	,reset: function() {
		/* setup registers */
		this.r = {
			PC: 0x0000
			,SP: 0x0000 // 0000 makes testing compared to zymosis work, but pretty sure it should be ffff
			,IFF1: 0
			,IFF2: 0
			,I: 0x00
			,R: 0x00
			,IM: 0
			,A: 0x00
			,F: 0x00
			,BC: 0x0000
			,DE: 0x0000
			,HL: 0x0000
			,AF2: 0x0000
			,BC2: 0x0000
			,DE2: 0x0000
			,HL2: 0x0000
			,IX: 0x0000
			,IY: 0x0000
		};

		this.clocks = 0;
		this.steps = 0;

		this.irq_count = 0;
		this.clocks_per_irq = 69800;
		this.clocks_to_irq = this.clocks_per_irq;
		this.request_ei = 0;
		this.immediate_address = 0;
		this.writeMEMPTR(0);
	}

	,status: function() {
		var regs = [
			{ e:'pc', v:this.readPC(), s:2 }
			,{ e:'af', v:this.readAF(), s:2 }
			,{ e:'bc', v:this.readBC(), s:2 }
			,{ e:'de', v:this.readDE(), s:2 }
			,{ e:'hl', v:this.readHL(), s:2 }
			,{ e:'af2', v:this.readAF2(), s:2 }
			,{ e:'bc2', v:this.readBC2(), s:2 }
			,{ e:'de2', v:this.readDE2(), s:2 }
			,{ e:'hl2', v:this.readHL2(), s:2 }
			,{ e:'ix', v:this.readIX(), s:2 }
			,{ e:'iy', v:this.readIY(), s:2 }
			,{ e:'sp', v:this.readSP(), s:2 }
			,{ e:'i', v:this.readI(), s:2 }
			,{ e:'r', v:this.readR(), s:2 }
			,{ e:'iff1', v:this.readIFF1(), s:1 }
			,{ e:'iff2', v:this.readIFF2(), s:1 }
			,{ e:'im', v:this.readIM(), s:1 }
			,{ e:'toirq', v:this.clocks_to_irq, s:3 }
			,{ e:'irqn', v:this.irq_count, s:2 }
		];

		for (var i in regs) {
			var r = regs[i];
			var n = 'jspec-r-' + r.e;
			var e = document.getElementById(n);
			var f = '%0' + r.s*2 + 'X';
			e.innerHTML = sprintf(f, r.v);
		}

		var sf =
			(this.getFS() ? 'S' : '-') +
			(this.getFZ() ? 'Z' : '-') +
			(this.getF5() ? '5' : '-') +
			(this.getFH() ? 'H' : '-') +
			(this.getF3() ? '3' : '-') +
			(this.getFP() ? 'P' : '-') +
			(this.getFN() ? 'N' : '-') +
			(this.getFC() ? 'C' : '-');

		var ib = [
			this.mmu.sread8(this.readPC()),
			this.mmu.sread8(this.readPC()+1),
			this.mmu.sread8(this.readPC()+2),
			this.mmu.sread8(this.readPC()+3)
		];
		var sib = sprintf('%02X %02X %02X %02X', ib[0], ib[1], ib[2], ib[3]);


		// generate disassembly string of instruction at current PC

		var od = this.opcode_descriptions.main[ib[0]];
		var disasm = od.disasm;

		if (od.operands.length > 0) {
			disasm = disasm.replace('%0', od.operand_hook[0].disasm(od.operands[0]));
		}
		if (od.operands.length > 1) {
			disasm = disasm.replace('%1', od.operand_hook[1].disasm(od.operands[1]));
		}
		disasm = disasm.replace('%ib', sprintf("$%02X", this.simmediate8()));
		disasm = disasm.replace('%iw', sprintf("$%04X", this.simmediate16()));
		disasm = disasm.replace('%d',
			sprintf("$%04X",
				(this.readPC() + this.displacement + 2) & 0xffff
			)
		);
		var disasm = stringPadRight(disasm, 16);


		var s1 = sprintf("%04X %s %s A:%02X F:%s SP:%04X BC:%04X DE:%04X HL:%04X BC2:%04X DE2:%04X HL2:%04X IX:%04X IY:%04X",
			this.readPC(),
			sib,
			disasm,
			this.readA(),
			sf,
			this.readSP(),
			this.readBC(),
			this.readDE(),
			this.readHL(),
			this.readBC2(),
			this.readDE2(),
			this.readHL2(),
			this.readIX(),
			this.readIY()
		);

		console.log(s1);
	}

	,fuzzState: function() {
		var self = this;

		return sprintf(
			"PC=%04x SP=%04x AF=%04x BC=%04x DE=%04x HL=%04x AF2=%04x BC2=%04x DE2=%04x HL2=%04x IX=%04x IY=%04x I=%02x\n"
			//,self.clocks
			,self.readPC()
			,self.readSP()
			,self.readAF() & 0xffd7
			,self.readBC()
			,self.readDE()
			,self.readHL()
			,self.readAF2()
			,self.readBC2()
			,self.readDE2()
			,self.readHL2()
			,self.readIX()
			,self.readIY()
			,self.readI()
		);
	}
	,fuzz: function(mode, seed, steps) {
		var self = this;
		g_fuzz_log = "";
		my_seed = seed;
		console.log("fuzz", mode, seed, steps);

		self.reset();

		$('#fuzz-output').html('fuzzing');

		if (mode == 0) {
			self.mmu = new FuzzRandomMemory();
			self.io = new FuzzRandomIO();
			fuzzLog(self.fuzzState());

			for (var i=0; i < steps; i++) {
				self.stepInstructions(1);
				fuzzLog(self.fuzzState());
			}
		} else if (mode == 1) {
			g_fuzz_log_enable = false;
			for (var i=0; i < seed; i++) {
				self.stepInstructions(1);
			}

			g_fuzz_log_enable = true;
			fuzzLog(self.fuzzState());
			for (var i=0; i < steps; i++) {
				self.stepInstructions(1);
				fuzzLog(self.fuzzState());
			}
		}

		$.ajax({
			url: "fuzz.php?mode=" + mode + "&seed=" + seed + "&steps=" + steps
			,type: "post"
			,data: JSON.stringify({data:g_fuzz_log})
			,success: function(response) {
				var html = "<pre>" + response + "</pre>";
				$('#fuzz-output').html(html);
			}
		});

	}
	,stepInstructions: function(count) {
		var self = this;
		while (count-- && !g_break) {
			self.displacement_skip = 0;

			var o = self.mmu.read8(self.readPC());
			this.immediate_address = self.readPC() + 1;
			self.r_add = 1;
			this.prefix_bytes = 0;
			var d = self.opcode_descriptions.main[o];
			if (d.handler === undefined) {
				console.error(d);
				return;
			}

			// execute handler and get real instruction (if prefixed)
			var ad = d.handler.call(self, d);

			// not prefixed?
			if (typeof ad === 'undefined') {
				// use the original handler
				ad = d;
			}

			this.writePC(this.readPC() + ad.size + this.prefix_bytes + this.displacement_skip);
			self.writeR((self.readR()+self.r_add) & 0x7f);

			self.steps++;
			self.clocks += d.clocks;
			self.clocks_to_irq -= d.clocks;

			if (self.clocks_to_irq <= 0) {
				self.clocks_to_irq = self.clocks_per_irq;
				self.IRQ();
			}

			if (this.request_ei) {
				this.request_ei = 0;
				self.writeIFF1(1);
				self.writeIFF2(1);
			}
		}

		if (g_break) {
			self.setDebug(1);
			return false;
		}

		return true;
	}
	,stepClocks: function(clocks_count) {
		var self = this;
		while (clocks_count >= 0) {

			if (self.readPC() == 0x123111) {
				g_breakpoint = 1;
				self.debug = 1;
				return false;
			}

			self.displacement_skip = 0;

			var o = self.mmu.read8(self.readPC());
			this.immediate_address = self.readPC() + 1;
			self.r_add = 1;
			this.prefix_bytes = 0;
			var d = self.opcode_descriptions.main[o];
			if (d.handler === undefined) {
				console.error(d);
				return;
			}

			// execute handler and get real instruction (if prefixed)
			var ad = d.handler.call(self, d);

			// not prefixed?
			if (typeof ad === 'undefined') {
				// use the original handler
				ad = d;
			}

			this.writePC(this.readPC() + ad.size + this.prefix_bytes + this.displacement_skip);
			self.writeR((self.readR()+self.r_add) & 0x7f);

			this.steps++;
			this.clocks += d.clocks;
			this.clocks_to_irq -= d.clocks;
			clocks_count -= d.clocks;

			if (this.clocks_to_irq <= 0) {
				this.clocks_to_irq = this.clocks_per_irq;
				this.IRQ();
			}

			if (this.request_ei) {
				this.request_ei = 0;
				this.writeIFF1(1);
				this.writeIFF2(1);
			}
		}
		return true;
	}
	,IRQ: function() {
		var self = this;

		if (self.r.IFF1 == 0) {
			// maskable interrupts are already disabled, nothing to do.
			return;
		}

		// disable maskable interrupts
		self.r.IFF1 = 0;
		self.r.IFF2 = 0;

		self.irq_count++;

		if (self.mmu.read8(self.readPC()) == 0x76) {
			// if HALT, skip to next instruction on return
			self.writePC(self.readPC() + 1);
		}

		// fate depends on interrupt mode
		switch (self.r.IM) {
			case 0 : {
				// IM0 : Intel 8080 compatibility mode.
				// read byte from data bus and execute it as an instruction.
				// data bus on standard spectrum is 0xff (RST $38)
				// FIXME: not generic - spectrum specific
				self.writeSP(self.readSP()-2);
				self.mmu.write16(self.readSP(), self.readPC() & 0xffff);
				self.writePC(0x38);
				break;
			}
			case 1 : {
				// IM1 : execute RST $38
				self.writeSP(self.readSP()-2);
				self.mmu.write16(self.readSP(), self.readPC() & 0xffff);
				self.writePC(0x38);
				break;
			}
			case 2 : {
				// IM2 : vectored interrupts
				var data_bus = 0xff; // data bus is always 0xff on spectrum
				var ivt_start = self.r.I << 8;
				var ivt_entry = ivt_start + data_bus;
				var iv_start = self.mmu.read16(ivt_entry);

				// call interrupt handler
				self.writeSP(self.readSP()-2);
				self.mmu.write16(self.readSP(), self.readPC() & 0xffff);
				self.writePC(iv_start);
				break;
			}
			default : {
				console.error("IRQ: invalid IM (" + self.r.IM + ")");
				break;
			}
		}

	}
	,NMI: function() {
		self.r.IFF2 = self.r.IFF1;
		self.r.IFF1 = 0;
	}

	,extractBits: function(x, m) {
		var b = 1, c = 0;
		while (c < 32) {
			if (b & m) break;
			b <<= 1;
			c++;
		}
		return (x&m) >> c;
	}
	,generateOpcodeDescriptions: function(opcode_templates) {
		var self = this;
		var id = 0;
		var it = 0;
		var descriptions = new Array(256);
		var errors = 0;

		// use a default handler for undefined instructions
		for (id=0; id<256; id++) {
			descriptions[id] = {
				callback: self.i_undef
				,disassembly: "UNDEFINED"
			};
		}

		// generate opcode descriptions for each opcode template
		for (id=0; id<256; id++) {
			for (it = 0; it < opcode_templates.length; ++it) {
				var t = opcode_templates[it];
				var p_mask = 0;
				for (p_mask_i = 0; p_mask_i < t.p.length; p_mask_i++) {
					p_mask |= t.p[p_mask_i].mask;
				}
				if ((id & ~(p_mask)) == t.o) {
					if (t.i === undefined) {
						console.error("opcode " + id.toString(16) + " is undefined");
						throw "";
					}
					var d = {
						clocks: t.i.c
						,size: t.i.s
						,operand_hook: t.p
						,disasm: t.i.disasm
						,handler: t.i.exec
					};
					d.operands = new Array(t.p.length);
					for (p_mask_i = 0; p_mask_i < t.p.length; p_mask_i++) {
						d.operands[p_mask_i] = self.extractBits(id, t.p[p_mask_i].mask);
					}

					descriptions[id] = d;
				}
			}
		}

		// check for unhandled opcodes
		for (id=0; id<256; id++) {
			var d = descriptions[id];
			if (!d.i) {
				//console.log("opcode unhandled : ", id);
				errors++;
			}
		}

		return descriptions;
	}

	/* register handlers */

	,readA: function() { return this.r.A; }
	,readF: function() { return this.r.F; }
	,readB: function() { return this.r.BC >> 8; }
	,readC: function() { return this.r.BC & 0xff; }
	,readD: function() { return this.r.DE >> 8; }
	,readE: function() { return this.r.DE & 0xff; }
	,readH: function() { return this.r.HL >> 8; }
	,readL: function() { return this.r.HL & 0xff; }
	,readAF: function() { return (this.r.A << 8) | this.r.F; }
	,readBC: function() { return this.r.BC; }
	,readDE: function() { return this.r.DE; }
	,readHL: function() {
		if (this.ix_flag) {
			return this.r.IX;
		}
		if (this.iy_flag) {
			return this.r.IY;
		}
		return this.r.HL;
	}
	,readAF2: function() { return this.r.AF2; }
	,readBC2: function() { return this.r.BC2; }
	,readDE2: function() { return this.r.DE2; }
	,readHL2: function() { return this.r.HL2; }
	,readSP: function() { return this.r.SP; }
	,readPC: function() { return this.r.PC; }
	,readIX: function() { return this.r.IX; }
	,readHX: function() { return this.r.IX >> 8; }
	,readLX: function() { return this.r.IX & 0xff; }
	,readIY: function() { return this.r.IY; }
	,readHY: function() { return this.r.IY >> 8; }
	,readLY: function() { return this.r.IY & 0xff; }
	,readI: function(x) { return this.r.I; }
	,readR: function(x) { return this.r.R; }
	,readIM: function(x) { return this.r.IM; }
	,readIFF1: function(x) { return this.r.IFF1; }
	,readIFF2: function(x) { return this.r.IFF2; }

	,getFC: function() { return this.r.F & 0x01; }
	,getFN: function() { return this.r.F & 0x02; }
	,getFP: function() { return this.r.F & 0x04; }
	,getF3: function() { return this.r.F & 0x08; }
	,getFH: function() { return this.r.F & 0x10; }
	,getF5: function() { return this.r.F & 0x20; }
	,getFZ: function() { return this.r.F & 0x40; }
	,getFS: function() { return this.r.F & 0x80; }

	,writeA: function(x) { this.r.A = x & 0xff; }
	,writeF: function(x) { this.r.F = x & 0xff; }
	,writeB: function(x) { this.r.BC = (this.r.BC & 0x00ff) | ((x << 8) & 0xff00); }
	,writeC: function(x) { this.r.BC = (this.r.BC & 0xff00) | (x & 0x00ff); }
	,writeD: function(x) { this.r.DE = (this.r.DE & 0x00ff) | ((x << 8) & 0xff00); }
	,writeE: function(x) { this.r.DE = (this.r.DE & 0xff00) | (x & 0x00ff); }
	,writeH: function(x) { this.r.HL = (this.r.HL & 0x00ff) | ((x << 8) & 0xff00); }
	,writeL: function(x) { this.r.HL = (this.r.HL & 0xff00) | (x & 0x00ff); }
	,writeHX: function(x) { this.r.IX = (this.r.IX & 0x00ff) | ((x << 8) & 0xff00); }
	,writeLX: function(x) { this.r.IX = (this.r.IX & 0xff00) | (x & 0x00ff); }
	,writeHY: function(x) { this.r.IY = (this.r.IY & 0x00ff) | ((x << 8) & 0xff00); }
	,writeLY: function(x) { this.r.IY = (this.r.IY & 0xff00) | (x & 0x00ff); }
	,writeAF: function(x) { this.r.A = (x >> 8) & 0xff; this.r.F = x & 0xff; }
	,writeBC: function(x) { this.r.BC = x & 0xffff; }
	,writeDE: function(x) { this.r.DE = x & 0xffff; }
	,writeHL: function(x) {
		if (this.ix_flag) {
			this.r.IX = x & 0xffff;
		} else if (this.iy_flag) {
			this.r.IY = x & 0xffff;
		} else {
			this.r.HL = x & 0xffff;
		}
	}
	,writeAF2: function(x) { this.r.AF2 = x & 0xffff; }
	,writeBC2: function(x) { this.r.BC2 = x & 0xffff; }
	,writeDE2: function(x) { this.r.DE2 = x & 0xffff; }
	,writeHL2: function(x) { this.r.HL2 = x & 0xffff; }
	,writeSP: function(x) { this.r.SP = x & 0xffff; }
	,writePC: function(x) { this.r.PC = x & 0xffff; }
	,writeIX: function(x) { this.r.IX = x & 0xffff; }
	,writeIY: function(x) { this.r.IY = x & 0xffff; }
	,writeI: function(x) { this.r.I = x & 0xff; }
	,writeR: function(x) { this.r.R = x & 0xff; }
	,writeIM: function(x) { this.r.IM = x; }
	,writeIFF1: function(x) { this.r.IFF1 = x; }
	,writeIFF2: function(x) { this.r.IFF2 = x; }

	,setFC: function() { this.r.F |= 0x01; }
	,setFN: function() { this.r.F |= 0x02; }
	,setFP: function() { this.r.F |= 0x04; }
	,setFV: function() { this.r.F |= 0x04; }
	,setF3: function() { this.r.F |= 0x08; }
	,setFH: function() { this.r.F |= 0x10; }
	,setF5: function() { this.r.F |= 0x20; }
	,setFZ: function() { this.r.F |= 0x40; }
	,setFS: function() { this.r.F |= 0x80; }
	,resetFC: function() { this.r.F &= ~0x01; }
	,resetFN: function() { this.r.F &= ~0x02; }
	,resetFP: function() { this.r.F &= ~0x04; }
	,resetFV: function() { this.r.F &= ~0x04; }
	,resetF3: function() { this.r.F &= ~0x08; }
	,resetFH: function() { this.r.F &= ~0x10; }
	,resetF5: function() { this.r.F &= ~0x20; }
	,resetFZ: function() { this.r.F &= ~0x40; }
	,resetFS: function() { this.r.F &= ~0x80; }

	,readMEMPTR: function() {
		return this.memptr;
	}
	,writeMEMPTR: function(x) {
		this.memptr = x & 0xffff;
	}

	/* parameterised operand handlers */

	/* read byte register/memory operand */

	,immediate8: function() {
		return this.mmu.read8(this.immediate_address);
	}
	,immediate16: function() {
		return this.mmu.read16(this.immediate_address);
	}
	,displacement: function() {
		return u2s8(this.mmu.read8(this.immediate_address));
	}

	,simmediate8: function() {
		return this.mmu.sread8(this.immediate_address);
	}
	,simmediate16: function() {
		return this.mmu.sread16(this.immediate_address);
	}
	,sdisplacement: function() {
		return u2s8(this.mmu.sread8(this.immediate_address));
	}

	,testCondition: function(cc) {
		var r = 0;

		switch (cc) {
			case 0 : /* NZ */ r = !(this.getFZ()); break;
			case 1 : /*  Z */ r =  (this.getFZ()); break;
			case 2 : /* NC */ r = !(this.getFC()); break;
			case 3 : /*  C */ r =  (this.getFC()); break;
			case 4 : /* PO */ r = !(this.getFP()); break;
			case 5 : /* PE */ r =  (this.getFP()); break;
			case 6 : /*  P */ r = !(this.getFS()); break;
			case 7 : /*  M */ r =  (this.getFS()); break;
		}
		return !!r;
	}

	,parity: function(x) {
		var count =
			!!(x & 0x80) + !!(x & 0x40) + !!(x & 0x20) + !!(x & 0x10) +
			!!(x & 0x08) + !!(x & 0x04) + !!(x & 0x02) + !!(x & 0x01);
		return !(count & 1);
	}
};

domLoaded(main);

function main()
{
	var machine = new Spectrum();
	g_machine = machine;
	machine.createUI("jspec");
	machine.setDebug(0);
	machine.run();
}

