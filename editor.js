// ---------------------------------------------------------------------------
//   mmmmmmm mmmmmm m    mmmmmmmm         mmmm    mm   mmmmm  mmmmm  mmmmmm
//      #    #       #  #    #           #"   "   ##   #    # #   "# #
//      #    #mmmmm   ##     #           "#mmm   #  #  #mmmm" #mmmm" #mmmmm
//      #    #       m""m    #               "#  #mm#  #    # #   "m #
//      #    #mmmmm m"  "m   #           "mmm#" #    # #mmmm" #    " #mmmmm
// ---------------------------------------------------------------------------
// 2024-12-21 version 1.00 by @pp19dd
//
//                           writeup: https://pp19dd.com/textsabre
//               radial pixel editor: https://pp19dd.com/textsabre/editor.html
//                        code + STL: https://github.com/pp19dd/textsabre
//
// ---------------------------------------------------------------------------
// in Arduino IDE: tools -> managed libraries -> search -> install
//      required library: FastGPIO by Pololu version 2.2.0
//      required library: APA102 by Pololu version 3.0.0
// ---------------------------------------------------------------------------

const led_rows      = 32;
const led_columns   = 144;

// #region DATA

// faster main lookup for getting / setting
// byte-agnostic, goes by above definition
let pixels = new Array(led_rows * led_columns).fill(-1);
let pixel_nodes = new Array(led_rows * led_columns);

function get_pixel(c, y, pixel_array) {
    const index = (c * led_rows) + y;
    if( typeof pixel_array === "undefined" ) {
        return( pixels[index] );
    } else {
        return( pixel_array[index] );
    }
}

function set_pixel(c, y, v) {
    const index = (c * led_rows) + y;
    pixels[index] = v;
}

function get_pixel_node(c, y) {
    const index = (c * led_rows) + y;
    return( pixel_nodes[index] );
}

function set_pixel_node(c, y, node) {
    const index = (c * led_rows) + y;
    pixel_nodes[index] = node;
}

// helper to reset color_0, color_1, etc.
function erase_colors(enode) {
    enode.removeClass("painted");
    for( let i = 0; i <= 9; i++ ) {
        enode.removeClass("color" + i);
    }
}

// repaints everything on canvas based on pixel data
function load_pixel_array(this_pixel_array) {

    for( let c = 0; c < led_columns; c++ ) {
        for( let y = 0; y < led_rows; y++ ) {
            const node = get_pixel_node(c, y);
            erase_colors( node );
            const pixel_value = get_pixel(c, y, this_pixel_array);
            if( pixel_value !== -1 ) {
                node.addClass("painted");
                node.addClass("color" + pixel_value);
            }
        }
    }
}

function load_output() {
    const image_index = document.querySelector("#image_index").value;
    const key = "sabre-" + image_index;

    if( localStorage.getItem(key) === null ) {
        alert( "nothing saved in localStorage " + key );
        return;
    }

    pixels = JSON.parse(localStorage.getItem(key));
    load_pixel_array( pixels );
    rotation = 0;
    main.transform("r" + rotation);

    update_output_code();
}

function save_output() {
    const image_index = document.querySelector("#image_index").value;
    const key = "sabre-" + image_index;

    if( localStorage.getItem(key) !== null ) {
        const user_choice = confirm("Overwrite localStorage " + key + " ?");
        if( user_choice === false ) return;
    }

    // save now
    localStorage.setItem(key, JSON.stringify(pixels));
}

// old:
// capture all values in led_rows = 32 * led_columns = 144;
// lol, no: separate by colors first, then byte rows, then columns
// new plan: columns first 0 - 144, 4 bytes at a time

// ok so this works, but it's a black + white model

// color mode, multi-planar bit packing mode, written for 4 bytes per column
// plane_0: colors 1, 3, 5, 7
// plane_1: colors 2, 3, 6, 7
// plane_2: colors 4, 5, 6, 7
// todo: encode colors palette array?
// returns({
//      meta: { },
//      code: ""
// }
function get_arduino_code(this_image_index, this_pixel_array) {
    let ret = {
        code: "",
        meta: {}
    };

    // const led_bytes = parseInt(Math.ceil(led_rows/8)); // 4
    let planes = [
        new Array(led_columns * 4).fill(0),
        new Array(led_columns * 4).fill(0),
        new Array(led_columns * 4).fill(0)
    ];

    let pixel_count = 0;
    let pixel_colors = {};

    for( let c = 0; c < led_columns; c++ ) {
        for( let b = 0; b < 4; b++ ) {
            for( let i = 0; i < 8; i++ ) {
                const ov = get_pixel(c, (b * 8) + i, this_pixel_array);
                const v = (ov === -1 ? 0 : (ov+1));

                if( ov !== -1 ) {
                    pixel_count++;
                }

                if( typeof pixel_colors[v] === "undefined" ) {
                    pixel_colors[v] = 0;
                }
                pixel_colors[v]++;
                
                if( v === 1 || v === 3 || v === 5 | v === 7 ) {
                    planes[0][(c * 4) + b] = bit_write(planes[0][(c * 4) + b], i );
                }
                if( v === 2 || v === 3 || v === 6 | v === 7 ) {
                    planes[1][(c * 4) + b] = bit_write(planes[1][(c * 4) + b], i );
                }
                if( v === 4 || v === 5 || v === 6 | v === 7 ) {
                    planes[2][(c * 4) + b] = bit_write(planes[2][(c * 4) + b], i );
                }
            }
        }
    }

    // let code = "";
    //if( include_headers === true ) {
        // code += `// image_${this_image_index}.h\n` +
        // `// ${led_rows} x ${led_columns} LEDs\n`;
    // }
    ret.meta.image_index = this_image_index;
    ret.meta.date = new Date().toLocaleString().split(",")[0].trim();
    ret.meta.time = new Date().toLocaleString().split(",")[1].trim();
    ret.meta.led_rows = led_rows;
    ret.meta.led_columns = led_columns;
    ret.meta.pixel_count = pixel_count;

    for( k in pixel_colors ) {
        ret.meta["color_" + k] = pixel_colors[k];
    }
    
    // code += `// ${pixel_count} pixels\n`;
    
    // if( include_headers === true ) {
        // code += "#include <Arduino.h>\n";
    // }

    for( let p = 0; p < planes.length; p++ ) {
        ret.code += `const uint8_t IMAGE_${this_image_index}_${p}[] PROGMEM = {`;
        for( let i = 0; i < planes[p].length; i++ ) {
            if( i % 16 === 0 ) ret.code += "\n";
            ret.code += byte_to_hex(planes[p][i]);
            if( i < planes[p].length - 1  ) ret.code += ", ";
        }
        ret.code += "\n};\n"
    }

    // code += planes[0].join(", ") + "\n\n";
    // code += "const uint8_t CHAR_M_1[] PROGMEM = {\n";
    // code += planes[1].join(", ") + "\n\n";
    // code += "const uint8_t CHAR_M_2[] PROGMEM = {\n";
    // code += planes[2].join(", ") + "\n\n";

    return( ret );
}

function get_all_images_arduino_code() {
    let code =
        "// date = " + new Date().toLocaleString().split(",")[0].trim() + "\n" +
        "// time = " + new Date().toLocaleString().split(",")[1].trim() + "\n" +
        `// led_rows = ${led_rows}\n` +
        `// led_columns = ${led_columns}\n\n` +
        `#include <Arduino.h>\n\n`;

    let blank_image = new Array(led_rows * led_columns).fill(-1);
    
    for( let i = 0; i < 8; i++ ) {

        let temp_code = "";
        const key = "sabre-" + i;

        if( localStorage.getItem(key) === null ) {
            temp_code = get_arduino_code(i, blank_image);
        } else {
            temp_code = get_arduino_code(i, JSON.parse(localStorage.getItem(key)));
        }

        code += "// " + "-".repeat(76) + "\n";
        code += `// image_${i}\n`;
        code += "// " + "-".repeat(76) + "\n";
        code += `// \tpixel_count = ${temp_code.meta.pixel_count}\n`;
        for( k in temp_code.meta ) {
            const e = k.split("_");
            if( e[0] === "color" ) {
                code += `// \t\t${k} = ${temp_code.meta[k]}\n`;
            }
        }
        code += "// " + "-".repeat(76) + "\n";
        code += temp_code.code + "\n";
    }
    return( code );
}

// for current image
function update_output_code() {
    const image = get_arduino_code(
        document.querySelector("#image_index").value,
        pixels
    );
    document.querySelector("#output").innerHTML = "";
    for( k in image.meta ) {
        document.querySelector("#output").innerHTML += 
            "// " + k + " = " + image.meta[k] + "\n";
    }
    document.querySelector("#output").innerHTML += "\n#include <Arduino.h>\n\n";
    document.querySelector("#output").innerHTML += image.code;
}


// #region INIT

// const led_bytes = parseInt(Math.ceil(led_rows/8));
// stores tracked bytes for output
// let tracked = new Array(led_columns * led_bytes);

let rotation = 0;
let is_left = false;
let is_right = false;
let current_color = 0;
let zoom_state = 0;

var paper = Snap("#svg");
paper.attr({ viewBox: "-1500 -1500 3000 1500"});
paper.circle(0, 0, 1375).attr({ class: 'area' });

document.addEventListener("DOMContentLoaded", (e) => {
    select_color( current_color );
    button_click_events();
    update_output_code();

    if( localStorage.getItem("sabre-zoom") !== null ) {
        zoom_state = JSON.parse(localStorage.getItem("sabre-zoom"));
        applyZoomState();
    }

    document.querySelector("#image_index").addEventListener("change", (e) => {
        // update_output_code();
        // actually, no, don't update this
    });

    document.querySelector("button#copy").addEventListener("click", (e) => {
        document.querySelector("#copy").classList.add("copied");
        setTimeout( () => {
            document.querySelector("#copy").classList.remove("copied");
        }, 1000);
        copy_output(document.getElementById("output").value);
    });

    document.querySelector("button#copy_all").addEventListener("click", (e) => {
        document.querySelector("#copy_all").classList.add("copied");
        setTimeout( () => {
            document.querySelector("#copy_all").classList.remove("copied");
        }, 1000);
        copy_output(get_all_images_arduino_code());
    });

    document.querySelector("button#save").addEventListener("click", (e) => {
        save_output();
    });

    document.querySelector("button#load").addEventListener("click", (e) => {
        load_output();
    });

    document.querySelector("button#new").addEventListener("click", (e) => {
        action_new();
    });
});

function button_click_events() {
    document.querySelectorAll(".hint-color kbd").forEach( (kbd) => {
        kbd.addEventListener("click", (e) => {
            const color = parseInt(kbd.innerHTML) - 1;
            if( color === -1 ) {
                select_color(9);
            } else {
                select_color( color );
            }
        });
    });

    document.querySelector(".hint-rotate .key-a").addEventListener("mousedown", (e) => {
        setRotationKeyLeft(true);
    });
    document.querySelector(".hint-rotate .key-a").addEventListener("mouseup", (e) => {
        setRotationKeyLeft(false);
    });

    document.querySelector(".hint-rotate .key-d").addEventListener("mousedown", (e) => {
        setRotationKeyRight(true);
    });
    document.querySelector(".hint-rotate .key-d").addEventListener("mouseup", (e) => {
        setRotationKeyRight(false);
    });

    document.querySelector(".hint-actions .key-z").addEventListener("mouseup", (e) => {
        toggleZoomKey();
    });
}

// #endregion

// #region BITS

function get_visual_byte(column, byte, specific_color) {
    let result = 0b0000_0000;
    const offset = byte * 8;
    for( let i = 0; i < 8; i++ ) {

        // const num_pixel = 33 - ((byte * 8) + i);
        const num_pixel = offset + i;

        // 32 leds, so last byte only has 2 bits
        // if( num_pixel >= led_rows ) break;

        // slow, replacing with faster?
        // const g_item = main.selectAll("g.column-" + column)[0][num_pixel];
        // if( g_item.hasClass("painted") ) result = bit_write(result, i);
        if( typeof specific_color === "undefined" ) {
            if( get_pixel(column, num_pixel) !== -1 ) result = bit_write(result, i);
        } else {
            if( get_pixel(column, num_pixel) === specific_color ) result = bit_write(result, i);
        }

    }
    return( result );
}

function bit_read(byte, position) {
    const mask = 0b0000_0001 << position;
    if( (byte & mask) > 0 ) return( true );
    return( false );
}

function bit_write(byte, position) {
    const mask = 0b0000_0001 << position;
    byte = byte | mask;
    return( byte );
}

function byte_encode(byte) {
    let ret = "0b";
    for( let i = 7; i >= 0; i-- ) {
        ret += (bit_read(byte,i) ? '1' : '0');
    }
    return( ret );
}

function byte_to_hex(byte) {
    const hex = (byte & 0xFF).toString(16); 
    return "0x" + (hex.length === 1 ? '0' + hex : hex);
}

// #endregion

// #endregion

// #region PIXEL

//                 wt
//             wt/2   wt/2
//                  |
//          --------+--------       h/2
//           \      |      /
//      ------+-----+-----+------      }  h
//             \    |    /
//              ----+----           h/2
//                  |
//             wb/2   wb/2
//                 wb

// draw one led pixel cell:
//  - visible path: smaller "pixel" (keeps gaps visible)
//  - hit path: full cell area (covers gaps so it's easy to click/drag)
function drawPixel(paper, options) {
    const angleSteps   = options.angle_steps || 60;
    const radius       = options.radius      || 1000;
    const pixelIndex   = options.pixel_index || 0;
    const pixelGap     = options.pixel_gap   || 8;
    const pixelLen     = options.pixel_len   || 20;
    const innerMargin  = options.inner_margin || 50;

    // visual fill fraction of the cell (0..1)
    const angularFill  = options.angular_fill ?? 0.7;

    // how much of the gap you want "owned" by this pixel for hit-testing.
    // 1.0 = include the entire gap in the hit cell height (recommended).
    const hitGapFrac   = options.hit_gap_frac ?? 1.0;

    // angle center
    let thetaCenterRad;
    if (typeof options.current_angle === "number") {
        thetaCenterRad = options.current_angle * Math.PI / 180;
    } else {
        const columnIndex = options.column_index || 0;
        const angleStepRad = 2 * Math.PI / angleSteps;
        thetaCenterRad = -Math.PI / 2 + columnIndex * angleStepRad;
    }

    const angleStepRad = 2 * Math.PI / angleSteps;

    function polar(r, theta) {
        return { x: r * Math.cos(theta), y: r * Math.sin(theta) };
    }

    function ringSlicePath(rInner, rOuter, thetaCenter, halfWidth) {
        const rOutClamped = Math.min(rOuter, radius);

        const p1 = polar(rInner,      thetaCenter - halfWidth);
        const p2 = polar(rInner,      thetaCenter + halfWidth);
        const p3 = polar(rOutClamped, thetaCenter + halfWidth);
        const p4 = polar(rOutClamped, thetaCenter - halfWidth);

        return [
        "M", p1.x, p1.y,
        "A", rInner, rInner, 0, 0, 1, p2.x, p2.y,
        "L", p3.x, p3.y,
        "A", rOutClamped, rOutClamped, 0, 0, 0, p4.x, p4.y,
        "Z"
        ].join(" ");
    }

    // --- cell geometry (full clickable region) ---
    // give the hit cell the entire angular step and (optionally) the gap too.
    const hitHalfWidth = angleStepRad / 2;

    const rInnerPixel = innerMargin + pixelIndex * (pixelLen + pixelGap);
    const rOuterPixel = rInnerPixel + pixelLen;

    const extra = (pixelGap * hitGapFrac);
    const rInnerHit = rInnerPixel - extra * 0.5;
    const rOuterHit = rOuterPixel + extra * 0.5;

    const dHit = ringSlicePath(rInnerHit, rOuterHit, thetaCenterRad, hitHalfWidth);

    // --- visible pixel geometry (smaller, leaves gaps) ---
    const visHalfWidth = (angleStepRad * angularFill) / 2;
    const dVis = ringSlicePath(rInnerPixel, rOuterPixel, thetaCenterRad, visHalfWidth);

    const g = paper.group();
    g.addClass("pixel");

    const hit = paper.path(dHit).attr({ class: "pixel-hit" }); // invisible
    const vis = paper.path(dVis).attr({ class: "pixel-vis" }); // visible

    // hit.data("pixel", vis); // store snap element reference

    g.add(hit);
    g.add(vis);

    return g;
}

// #endregion

// #region BOARD

const main = paper.group();

let count_column = 0;
const steps = led_columns;
const offset = 7;
const angle_offset = -90;
for( let a = 0 + angle_offset; a < 360 + angle_offset; a += 360/steps ) {
    const g = paper.group();
    g.addClass("column");
    g.addClass("column-" + count_column);
    for( let i = 0 + offset; i < led_rows + offset; i++ ) {
        const pixel = drawPixel(paper, {
            radius      : 1400,
            num_pixels  : led_rows + offset,
            angle_steps : steps,                // columns around the circle
            pixel_index : i,                    // 0..numPixels-1
            pixel_gap   : 8,                    // radial gap between LEDs
            pixel_len   : 25,                   // radial length of 1 LED
            inner_margin : 80,                  // distance from center to first LED
            current_angle: a,
        });
        
        // staple info to pixel-hit
        pixel.addClass("pixel-" + (i - offset));

        // reverse and forward lookups
        // set on g.pixel
        pixel.data("c", count_column); 
        pixel.data("y", (i - offset));
        set_pixel_node(count_column, (i - offset), pixel );

        // pixel[0].data("y", 32 - (i - offset + 1));
        g.add(pixel);
    }
    // g.mouseover(function(e) { g.attr({ opacity: 0.5 }) });
    // g.mouseout(function(e) { g.attr({ opacity: 1 }) });

    if( count_column % 5 ) {
    } else {
        const t = paper.text(0,0, count_column.toString()).attr({"class": "angle"});
        t.transform("r" + a + ",0,0 t1400,0");
        g.add( t );
    }
    main.add( g );
    count_column++;
}

// #endregion

// #region MOUSE

let is_painting = false;
let is_erasing = false;

// target must be path.pixel-hit
// verified by both .click and .mouseover
// applies painting or erasure
// sigh, change to g

// function evaluate_click(target_path) {
function evaluate_click(g_pixel) {
    // const g_pixel = Snap(target_path.parentNode);
    // if( typeof g_pixel[0] === "undefined" ) {
    //     console.warn( "undefined" );
    //     return;
    // }
    
    const node = Snap(g_pixel);

    const c = node.data("c");
    const y = node.data("y");

    erase_colors(node);

    if( is_painting ) {
        // node is g.pixel
        node.addClass("painted");
        node.addClass("color" + current_color)
        set_pixel(c, y, current_color);
    }

    if( is_erasing ) {
        // node.removeClass("painted");
        set_pixel(c, y, -1);
    }

}

// determines whether we're erasing or painting
// target must be path.pixel-hit
paper.mousedown( function(e) {
    if( !e.target.classList.contains("pixel-hit") ) return;
    const g_pixel = Snap(e.target.parentNode);

    const node = Snap(g_pixel);
    const c = node.data("c");
    const y = node.data("y");


    // if( is_painting || is_erasing ) return;
    // if( !e.target.classList.contains("pixel-hit") ) return;

    // const pixel = Snap(e.target).data("pixel");
    
    // if( g_pixel.hasClass("painted") ) {
    if( get_pixel(c, y) !== -1 ) {
        is_erasing = true;
    } else {
        is_painting = true;
    }
    
    evaluate_click( e.target.parentNode );
    update_tooltip(e.target);
    update_output_code();
});

paper.mouseup( function(e) {
    is_painting = false;
    is_erasing = false;
});

// c, y, num, start
function get_visual_byte_range(c, y) {
    return({
        c: c,
        y: y,
        n: (y >= 32 ? 2 : 8), // hardcoded 2 bit case
        s: (Math.floor(y / 8) * 8)
    });
}

paper.mouseover(function(e) {
    
    // clear out
    if( !e.target.classList.contains("pixel-hit") ) {
        document.querySelector("#tip_left").style.opacity = 0;
        return;
    }

    // outline current pixel
    Snap(e.target.nextElementSibling).addClass("mouseover");

    // outline current byte
    const c = Snap(e.target.parentNode).data("c");
    const y = Snap(e.target.parentNode).data("y");
    const range = get_visual_byte_range(c, y);

    for( let i = 0; i < range.n; i++ ) {
        // const g_item = main.selectAll("g.column-" + Snap(e.target).data("c"))[0][range.s + i][1];
        const g_item = get_pixel_node(c, range.s + i)
        g_item[1].addClass("mouseover-byte");
    }

    // draw if click
    if( e.buttons === 1 ) {
        // evaluate_click( e.target);
        
        // confirmed g.pixel
        evaluate_click( e.target.parentNode );
        update_tooltip( e.target );
        update_output_code();
    } else {
        update_tooltip(e.target);
        // update_output_code();
    }
});

paper.mouseout(function(e) {

    // clear out
    if( !e.target.classList.contains("pixel-hit") ) {
        document.querySelector("#tip_left").style.opacity = 0;
        return;
    }

    Snap(e.target.nextElementSibling).removeClass("mouseover");

    // outline current byte
    const c = Snap(e.target.parentNode).data("c");
    const y = Snap(e.target.parentNode).data("y");
    const range = get_visual_byte_range(c, y);

    for( let i = 0; i < range.n; i++ ) {
        const g_item = get_pixel_node(c, range.s + i)
        g_item[1].removeClass("mouseover-byte");
    }

});

// #endregion

// #region TOOLTIP

function pad(n, l) {
    const z = String(n).padStart(l, '0');
    return(z);
}

function update_tooltip(e_target) {
    const c = Snap(e_target.parentNode).data("c");
    const y = Snap(e_target.parentNode).data("y");
    
    const b = Math.floor(y / 8);
    const bit = y - (b * 8);

    // old b&w mode - still handy to see
    const byte = get_visual_byte(c, b)

    // new plane mode
    let p = [0b0000_0000, 0b0000_0000, 0b0000_0000];
    for( let i = 0; i < 8; i++ ) {
        const ov = get_pixel(c, (b * 8) + i, pixels);
        const v = (ov === -1 ? 0 : (ov+1));

        if( v === 1 || v === 3 || v === 5 | v === 7 ) {
            p[0] = bit_write(p[0], i );
        }
        if( v === 2 || v === 3 || v === 6 | v === 7 ) {
            p[1] = bit_write(p[1], i );
        }
        if( v === 4 || v === 5 || v === 6 | v === 7 ) {
            p[2] = bit_write(p[2], i );
        }
    }
    
    document.querySelector("#tip_left").style.opacity = 1;
    document.querySelector("#tip_left").innerHTML = 
        "column = " + pad(c, 3) + 
        ", y = " + pad(y, 2) + 
        "<br/>byte = " + b + ", bit = " + bit +
        "<div class='byte-row dark'>" +
            "<div>p0</div>" +
            "<div>" + byte_encode(p[0]) + "</div>" + 
            "<div>" + byte_to_hex(p[0]) + "</div>" +
        "</div>" +
        "<div class='byte-row dark'>" +
            "<div>p1</div>" +
            "<div>" + byte_encode(p[1]) + "</div>" + 
            "<div>" + byte_to_hex(p[1]) + "</div>" +
        "</div>" +
        "<div class='byte-row dark'>" +
            "<div>p2</div>" +
            "<div>" + byte_encode(p[2]) + "</div>" + 
            "<div>" + byte_to_hex(p[2]) + "</div>" +
        "</div>" +
        "<div class='byte-row'>" +
            "<div>bw</div>" +
            "<div>" + byte_encode(byte) + "</div>" + 
            "<div>" + byte_to_hex(byte) + "</div>" +
        "</div>";
}



function copy_output(text) {
    // const text = document.getElementById("output").value;
    
    const textarea = document.createElement( "textarea" );
    textarea.value = text;
    
    // prevent page jump on focus
    textarea.style.position = "fixed";
    textarea.style.top = '0';
    textarea.style.left = '0';
    textarea.style.opacity = '0';
    
    document.body.appendChild( textarea );
    textarea.focus();
    textarea.select();
    
    document.execCommand( 'copy' );
    document.body.removeChild( textarea );
}

// #endregion

// #region ACTIONS
function action_new() {
    rotation = 0;
    main.transform("r" + rotation);
    pixels = new Array(led_rows * led_columns).fill(-1);
    load_pixel_array(pixels);
    update_output_code();
}
// #endregion


// #region KEYS

function select_color(color_index) {
    current_color = color_index;

    document.querySelectorAll(".hint-color kbd").forEach( (kbd, index) => {
        kbd.classList.remove("selected");
    });

    document.querySelector(".hint-color .color" + current_color).classList.add("selected");
}

document.addEventListener("keypress", function(k) {
    for( let i = 0; i <= 7; i++ ) {
        if( k.key === i.toString() ) {
            // if( i === 0 ) {
                // select_color(9);
            //  } else {
            select_color( i-1 );
            //  }
        }
    }

    if( k.key.toLowerCase() === "z" ) {
        toggleZoomKey();
    }
});

document.addEventListener("keydown", function(k) {
    if( k.key === "ArrowLeft" || k.key === "a" ) setRotationKeyLeft(true);
    if( k.key === "ArrowRight" || k.key === "d" ) setRotationKeyRight(true);
});
document.addEventListener("keyup", function(k) {
    if( k.key === "ArrowLeft" || k.key === "a" ) setRotationKeyLeft(false);
    if( k.key === "ArrowRight" || k.key === "d" ) setRotationKeyRight(false);
});

function do_rotation() {
    if( is_left ) rotation -= 3;
    if( is_right ) rotation += 3;
    main.transform("r" + rotation);
    requestAnimationFrame(do_rotation);
}

requestAnimationFrame(do_rotation);

function applyZoomState() {
    switch( zoom_state ) {
        case 0:
            paper.attr({ viewBox: "-1500 -1500 3000 1500"});
            document.querySelector(".hint-actions .key-z").classList.add("selected");
        break;

        case 1:
            paper.attr({ viewBox: "-1500 -1500 3000 3000"});
            document.querySelector(".hint-actions .key-z").classList.remove("selected");
        break;
    }
}

function toggleZoomKey() {
    zoom_state++;
    if( zoom_state > 1 ) zoom_state = 0;
    applyZoomState();

    localStorage.setItem("sabre-zoom", JSON.stringify(zoom_state));
}

function setRotationKeyLeft(value) {
    is_left = value;
    if( value === false ) {
        document.querySelector(".hint-rotate .key-a").classList.remove("selected");
    } else {
        document.querySelector(".hint-rotate .key-a").classList.add("selected");
    }
}

function setRotationKeyRight(value) {
    is_right = value;
    if( value === false ) {
        document.querySelector(".hint-rotate .key-d").classList.remove("selected");
    } else {
        document.querySelector(".hint-rotate .key-d").classList.add("selected");
    }
}

function clearKeys() {
    setRotationKeyLeft(false);
    setRotationKeyRight(false);
    // is_left = false;
    // is_right = false;

    // document.querySelector(".hint-rotate .key-a").classList.remove("selected");
    // document.querySelector(".hint-rotate .key-d").classList.remove("selected");
}

// If you alt-tab / click away, you might never see keyup:
window.addEventListener("blur", clearKeys);

// If the tab gets backgrounded/foregrounded:aa
document.addEventListener("visibilitychange", () => {
    if( document.hidden ) clearKeys();
});

// Optional extra safety:
window.addEventListener("focus", clearKeys);

// #endregion
