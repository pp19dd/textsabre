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
// wrap-around built-in into get, set pixel
let pixels = new Array(led_rows * led_columns).fill(-1);
let pixel_nodes = new Array(led_rows * led_columns);

function normalized_c(c) {
	return( (c % led_columns + led_columns) % led_columns );
}

function normalized_y(y) {
	return( (y % led_rows + led_rows) % led_rows );
}

function get_pixel(c, y, pixel_array) {
    const index = (normalized_c(c) * led_rows) + normalized_y(y);
    if( typeof pixel_array === "undefined" ) {
        return( pixels[index] );
    } else {
        return( pixel_array[index] );
    }
}

function set_pixel(c, y, v, pixel_array) {
    const index = (normalized_c(c) * led_rows) + normalized_y(y);
    if( typeof pixel_array === "undefined" ) {
        pixels[index] = v;
    } else {
        pixel_array[index] = v;
    }
}

function get_pixel_node(c, y) {
    const index = (normalized_c(c) * led_rows) + normalized_y(y);
    return( pixel_nodes[index] );
}

function set_pixel_node(c, y, node) {
    const index = (normalized_c(c) * led_rows) + normalized_y(y);
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

// returns a list of pixel differences, if any
function compare_pixel_array(pixel_array1, pixel_array2) {
    let differences = [];
    for( let i = 0; i < pixel_array1.length; i++ ) {
        if( pixel_array1[i] !== pixel_array2[i] ) {
            differences.push( i );
        }
    }
    return( differences );
}

const storage_prefix = "sabre-";
const storage_backup_counter_key = "textsabre-backup-counter";
const storage_backup_version = 1;
const storage_color_key = "sabre-current-color";
const storage_rotation_key = "sabre-rotation";
const storage_zoom_key = "sabre-zoom";
const storage_history_key = "sabre-undo-history";

// Undo stores full image snapshots, one entry per completed paint/erase gesture.
// Bump this up/down as desired; memory use is roughly rows * columns * steps integers.
const undo_step_limit = 25;
let active_image_index = "0";

let image_history = {};

function clone_history_stack(stack) {
    if( !Array.isArray(stack) ) return( [] );

    return( stack
        .filter((snapshot) => valid_pixel_array(snapshot))
        .map((snapshot) => snapshot.slice())
    );
}

function trim_history_stack(stack) {
    while( stack.length > undo_step_limit ) {
        stack.shift();
    }
}

function save_history_to_localstorage() {
    const saved_history = {};

    Object.keys(image_history).forEach((slot) => {
        const h = image_history[slot];

        saved_history[slot] = {
            undo_stack: clone_history_stack(h.undo_stack),
            redo_stack: clone_history_stack(h.redo_stack)
        };
    });

    try {
        localStorage.setItem(storage_history_key, JSON.stringify(saved_history));
    } catch(err) {
        console.warn("Could not save undo history to localStorage", err);
    }
}

function load_history_from_localstorage() {
    const saved = localStorage.getItem(storage_history_key);
    image_history = {};

    if( saved === null ) return;

    try {
        const parsed = JSON.parse(saved);
        if( parsed === null || typeof parsed !== "object" || Array.isArray(parsed) ) return;

        Object.keys(parsed).forEach((slot) => {
            const h = parsed[slot];
            const undo_stack = clone_history_stack(h && h.undo_stack);
            const redo_stack = clone_history_stack(h && h.redo_stack);

            trim_history_stack(undo_stack);
            trim_history_stack(redo_stack);

            image_history[slot] = {
                undo_stack: undo_stack,
                redo_stack: redo_stack,
                pending_undo_pixels: null
            };
        });
    } catch(err) {
        console.warn("Could not parse localStorage " + storage_history_key, err);
        image_history = {};
    }
}

function remove_history_from_localstorage() {
    localStorage.removeItem(storage_history_key);
}

function get_image_history(image_index) {
    const slot = image_index.toString();

    if( typeof image_history[slot] === "undefined" ) {
        image_history[slot] = {
            undo_stack: [],
            redo_stack: [],
            pending_undo_pixels: null
        };
    }

    return image_history[slot];
}

const image_slot_content_mark = " ☼";

function get_current_image_index() {
    return( active_image_index );
}

function get_storage_key(image_index) {
    return( storage_prefix + image_index );
}

function blank_pixel_array() {
    return( new Array(led_rows * led_columns).fill(-1) );
}

function valid_pixel_array(candidate) {
    return(
        Array.isArray(candidate) &&
        candidate.length === led_rows * led_columns
    );
}

function pixel_array_has_content(pixel_array) {
    if( !valid_pixel_array(pixel_array) ) return( false );
    return( pixel_array.some((pixel) => pixel !== -1) );
}

function localstorage_image_has_content(image_index) {
    return( pixel_array_has_content(load_pixels_from_localstorage(image_index)) );
}

function update_image_index_markers() {
    const select = document.querySelector("#image_index");
    if( !select ) return;

    Array.from(select.options).forEach((option) => {
        const has_content = localstorage_image_has_content(option.value);
        const hotkey_number = parseInt(option.value, 10) + 1;
        option.textContent = "image_" + option.value + (has_content ? image_slot_content_mark : "");
        option.title = "Alt+" + hotkey_number + " switches to image_" + option.value;
        option.classList.toggle("has-content", has_content);
    });
}

function load_pixels_from_localstorage(image_index) {
    const key = get_storage_key(image_index);
    const saved = localStorage.getItem(key);

    if( saved === null ) {
        return( blank_pixel_array() );
    }

    try {
        const parsed = JSON.parse(saved);
        if( valid_pixel_array(parsed) ) {
            return( parsed );
        }
    } catch(err) {
        console.warn("Could not parse localStorage " + key, err);
    }

    return( blank_pixel_array() );
}

function save_pixels_to_localstorage(image_index, pixel_array) {
    const key = get_storage_key(image_index);
    localStorage.setItem(key, JSON.stringify(pixel_array));
}

function autosave_current_image(image_index) {
    // Be explicit here. Browsers can expose #image_index as a global named image_index,
    // which made autosave write to sabre-[object HTMLSelectElement] instead of sabre-0, etc.
    const slot = (
        typeof image_index === "undefined"
            ? active_image_index
            : image_index.toString()
    );

    save_pixels_to_localstorage(slot, pixels);
    update_image_index_markers();
}

function same_pixel_array(pixel_array1, pixel_array2) {
    if( !valid_pixel_array(pixel_array1) || !valid_pixel_array(pixel_array2) ) return( false );
    for( let i = 0; i < pixel_array1.length; i++ ) {
        if( pixel_array1[i] !== pixel_array2[i] ) return( false );
    }
    return( true );
}

function clear_history(image_index) {
    const h = get_image_history(
        typeof image_index === "undefined" ? active_image_index : image_index
    );

    h.undo_stack = [];
    h.redo_stack = [];
    h.pending_undo_pixels = null;

    save_history_to_localstorage();
    update_undo_redo_buttons();
}

function clear_all_history() {
    image_history = {};
    remove_history_from_localstorage();
    update_undo_redo_buttons();
}

function push_undo_snapshot(snapshot) {
    if( !valid_pixel_array(snapshot) ) return;

    const h = get_image_history(active_image_index);

    h.undo_stack.push(snapshot.slice());

    while( h.undo_stack.length > undo_step_limit ) {
        h.undo_stack.shift();
    }

    h.redo_stack = [];

    save_history_to_localstorage();
    update_undo_redo_buttons();
}

function begin_undoable_pixel_edit() {
    const h = get_image_history(active_image_index);

    if( h.pending_undo_pixels === null ) {
        h.pending_undo_pixels = pixels.slice();
    }
}

function commit_undoable_pixel_edit() {
    const h = get_image_history(active_image_index);

    if( h.pending_undo_pixels === null ) return;

    const before = h.pending_undo_pixels;
    h.pending_undo_pixels = null;

    if( same_pixel_array(before, pixels) ) {
        update_undo_redo_buttons();
        return;
    }

    push_undo_snapshot(before);
}

function set_history_control_state(control, is_available) {
    if( !control ) return;

    const is_button = control.tagName.toLowerCase() === "button";

    if( is_button ) {
        control.disabled = !is_available;
        control.hidden = false;
    }

    control.classList.toggle("active", is_available);
    control.classList.toggle("disabled", !is_available);
    control.classList.toggle("selected", false);
    control.setAttribute("aria-disabled", is_available ? "false" : "true");
}

function update_undo_redo_buttons() {
    const h = get_image_history(active_image_index);
    const can_undo = h.undo_stack.length > 0;
    const can_redo = h.redo_stack.length > 0;

    set_history_control_state(document.querySelector(".hint-history .key-undo"), can_undo);
    set_history_control_state(document.querySelector(".hint-history .key-redo"), can_redo);
}

function restore_pixels_from_history(snapshot) {
    if( !valid_pixel_array(snapshot) ) return;
    pixels = snapshot.slice();
    load_pixel_array(pixels);
    update_output_code();
    autosave_current_image();
}

function action_undo() {
    commit_undoable_pixel_edit();

    const h = get_image_history(active_image_index);

    if( h.undo_stack.length === 0 ) return;

    h.redo_stack.push(pixels.slice());

    restore_pixels_from_history(h.undo_stack.pop());

    save_history_to_localstorage();
    update_undo_redo_buttons();
}


function action_redo() {
    commit_undoable_pixel_edit();

    const h = get_image_history(active_image_index);

    if( h.redo_stack.length === 0 ) return;

    h.undo_stack.push(pixels.slice());

    while( h.undo_stack.length > undo_step_limit ) {
        h.undo_stack.shift();
    }

    restore_pixels_from_history(h.redo_stack.pop());

    save_history_to_localstorage();
    update_undo_redo_buttons();
}

function switch_image_slot(next_image_index, previous_image_index) {
    commit_undoable_pixel_edit();

    const next = parseInt(next_image_index, 10);
    if( !Number.isInteger(next) || next < 0 || next > 7 ) return;

    const next_slot = next.toString();

    const previous_slot = (
        typeof previous_image_index === "undefined"
            ? active_image_index
            : previous_image_index.toString()
    );

    if( next_slot === previous_slot ) {
        active_image_index = next_slot;
        document.querySelector("#image_index").value = active_image_index;
        return;
    }

    // Save the image we are leaving.
    save_pixels_to_localstorage(previous_slot, pixels);

    active_image_index = next_slot;
    document.querySelector("#image_index").value = active_image_index;

    
    pixels = load_pixels_from_localstorage(active_image_index);
    load_pixel_array(pixels);
    update_output_code();
    update_image_index_markers();
    update_undo_redo_buttons();
}

function load_current_image_from_localstorage() {
    pixels = load_pixels_from_localstorage(active_image_index);
    load_pixel_array(pixels);
    main.transform("r" + rotation + ",0,0");
    update_output_code();
    update_image_index_markers();
}

function get_next_backup_number() {
    const current = parseInt(localStorage.getItem(storage_backup_counter_key) || "0", 10);
    const next = Number.isFinite(current) ? current + 1 : 1;
    localStorage.setItem(storage_backup_counter_key, next.toString());
    return( next );
}

function get_textsabre_backup() {
    autosave_current_image();

    const backup = {
        app: "textsabre",
        version: storage_backup_version,
        saved_at: new Date().toISOString(),
        led_rows: led_rows,
        led_columns: led_columns,
        selected_image_index: get_current_image_index(),
        editor_state: {
            current_color: current_color,
            view_state: view_state,
            zoom_state: view_state, // backward-compatible save field
            rotation: rotation
        },
        images: {}
    };

    for( let i = 0; i < 8; i++ ) {
        backup.images[i] = load_pixels_from_localstorage(i);
    }

    return( backup );
}

function download_text_file(filename, text) {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function save_output() {
    const backup_number = get_next_backup_number();
    const filename = "textsabre" + backup_number.toString().padStart(2, "0") + ".txt";
    const backup = get_textsabre_backup();
    download_text_file(filename, JSON.stringify(backup, null, 2));
}

function load_output() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".txt,application/json,text/plain";

    input.addEventListener("change", (e) => {
        const file = e.target.files[0];
        if( !file ) return;

        const reader = new FileReader();
        reader.addEventListener("load", () => {
            try {
                const backup = JSON.parse(reader.result);

                if( backup.app !== "textsabre" || typeof backup.images !== "object" ) {
                    alert("This does not look like a textsabre save file.");
                    return;
                }

                for( let i = 0; i < 8; i++ ) {
                    const image = backup.images[i];
                    if( valid_pixel_array(image) ) {
                        save_pixels_to_localstorage(i, image);
                    }
                }

                if( typeof backup.selected_image_index !== "undefined" ) {
                    const select = document.querySelector("#image_index");
                    select.value = backup.selected_image_index.toString();
                    active_image_index = select.value;
                }

                if( backup.editor_state && typeof backup.editor_state === "object" ) {
                    restore_editor_state(backup.editor_state);
                    select_color(current_color);
                    applyViewState();
                    applyRotationState();
                    save_editor_state_to_localstorage();
                }

                clear_all_history();
                load_current_image_from_localstorage();
            } catch(err) {
                console.error(err);
                alert("Could not load that textsabre file.");
            }
        });

        reader.readAsText(file);
    });

    input.click();
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

    ret.meta.image_index = this_image_index;
    ret.meta.date = new Date().toLocaleString().split(",")[0].trim();
    ret.meta.time = new Date().toLocaleString().split(",")[1].trim();
    ret.meta.led_rows = led_rows;
    ret.meta.led_columns = led_columns;
    ret.meta.pixel_count = pixel_count;

    for( k in pixel_colors ) {
        ret.meta["color_" + k] = pixel_colors[k];
    }

    for( let p = 0; p < planes.length; p++ ) {
        ret.code += `const uint8_t IMAGE_${this_image_index}_${p}[] PROGMEM = {`;
        for( let i = 0; i < planes[p].length; i++ ) {
            if( i % 16 === 0 ) ret.code += "\n";
            ret.code += byte_to_hex(planes[p][i]);
            if( i < planes[p].length - 1  ) ret.code += ", ";
        }
        ret.code += "\n};\n"
    }

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

function clamp_number(value, min, max, fallback) {
    const parsed = Number(value);
    if( Number.isFinite(parsed) && parsed >= min && parsed <= max ) {
        return( parsed );
    }
    return( fallback );
}

function restore_editor_state(state) {
    if( typeof state.current_color !== "undefined" ) {
        current_color = clamp_number(state.current_color, 0, 9, current_color);
    }

    if( typeof state.view_state !== "undefined" ) {
        view_state = clamp_number(state.view_state, 0, 1, view_state);
    } else if( typeof state.zoom_state !== "undefined" ) {
        view_state = clamp_number(state.zoom_state, 0, 1, view_state);
    }

    if( typeof state.rotation !== "undefined" ) {
        rotation = clamp_number(state.rotation, -360000, 360000, rotation);
        prev_rotation = rotation;
    }
}

function load_editor_state_from_localstorage() {
    restore_editor_state({
        current_color: localStorage.getItem(storage_color_key),
        view_state: localStorage.getItem(storage_zoom_key),
        rotation: localStorage.getItem(storage_rotation_key)
    });
}

function save_editor_state_to_localstorage() {
    localStorage.setItem(storage_color_key, current_color.toString());
    localStorage.setItem(storage_zoom_key, view_state.toString());
    localStorage.setItem(storage_rotation_key, rotation.toString());
}

function save_rotation_to_localstorage() {
    localStorage.setItem(storage_rotation_key, rotation.toString());
}

function applyRotationState() {
    main.transform("r" + rotation + ",0,0");
}


// #region INIT

let rotation = 0;
let prev_rotation = 0;
let is_left = false;
let is_right = false;
let current_color = 0;
let view_state = 0;

// from raphaeljs days
Snap.plugin(function(Snap, Element) {
    Element.prototype.toFront = function() {
        this.appendTo(this.parent());
        return this;
    };
});

var paper = Snap("#svg");
paper.attr({ viewBox: "-1500 -1500 3000 1500"});
paper.circle(0, 0, 1375).attr({ class: 'area' });

document.addEventListener("DOMContentLoaded", (e) => {
    load_editor_state_from_localstorage();
    select_color( current_color );
    button_click_events();
    applyViewState();
    applyRotationState();
    active_image_index = document.querySelector("#image_index").value;
    load_history_from_localstorage();
    load_current_image_from_localstorage();
    document.querySelector("#image_index").title = "Switch image slots with Alt+1 through Alt+8";
    update_undo_redo_buttons();

    // standardized visual effect acknowledging a click
    document.querySelectorAll("button").forEach( (button) => {
        button.addEventListener("click", (e) => {
            button.classList.add("clicked");
            setTimeout( () => {
                button.classList.remove("clicked");
            }, 1000);
        });
    });

    document.querySelector("button#copy").addEventListener("click", (e) => {
        copy_output(document.getElementById("output").value);
    });

    document.querySelector("button#copy_all").addEventListener("click", (e) => {
        copy_output(get_all_images_arduino_code());
    });

    document.querySelector("button#clear_all").addEventListener("click", (e) => {
        action_clear_all();
    });

    document.querySelector(".hint-history .key-undo").addEventListener("click", (e) => {
        if( e.currentTarget.getAttribute("aria-disabled") === "true" ) return;
        action_undo();
    });

    document.querySelector(".hint-history .key-redo").addEventListener("click", (e) => {
        if( e.currentTarget.getAttribute("aria-disabled") === "true" ) return;
        action_redo();
    });

    const image_select = document.querySelector("#image_index");
    image_select.dataset.previousValue = image_select.value;
    image_select.addEventListener("focus", (e) => {
        e.target.dataset.previousValue = active_image_index;
    });
    image_select.addEventListener("mousedown", (e) => {
        e.target.dataset.previousValue = active_image_index;
    });
    image_select.addEventListener("change", (e) => {
        const previous = e.target.dataset.previousValue || active_image_index;
        const next = e.target.value;

        switch_image_slot(next, previous);

        e.target.dataset.previousValue = active_image_index;
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

    paper.node.addEventListener("mousedown", function(e) {
        if(
            active_tool !== "line" &&
            active_tool !== "circle" &&
            active_tool !== "disc"
        ) return;

        // Normal pixel mousedown already handles this.
        if( e.target && e.target.classList && e.target.classList.contains("pixel-hit") ) return;

        const p = board_point_from_mouse_event(e);

        if( !point_is_in_center_deadzone(p) ) return;

        e.preventDefault();

        begin_undoable_pixel_edit();

        // I would make deadzone starts draw, not toggle erase.
        // There is no pixel there to infer erase from.
        is_painting = !e.shiftKey;
        is_erasing = e.shiftKey;

        tool_drag_start = { x: p.x, y: p.y };
        tool_drag_last = { x: p.x, y: p.y };

        show_tool_preview_shape(tool_drag_start, tool_drag_last);
        show_tool_preview([]);
    });

    paper.node.addEventListener("mousemove", function(e) {
        if( !is_painting && !is_erasing ) return;
        if(
            active_tool !== "line" &&
            active_tool !== "circle" &&
            active_tool !== "disc"
        ) return;
        if( tool_drag_start === null ) return;

        const pixel = pixel_from_event_target(e.target);

        if( pixel !== null ) {
            tool_drag_last = { c: pixel.c, y: pixel.y };
        } else {
            const p = board_point_from_mouse_event(e);
            tool_drag_last = { x: p.x, y: p.y };
        }

        show_tool_preview_shape(tool_drag_start, tool_drag_last);
        show_tool_preview(pixels_for_drag_tool(tool_drag_start, tool_drag_last));
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

    document.querySelector(".hint-actions .key-v").addEventListener("mouseup", (e) => {
        toggleViewKey();
    });

    document.querySelector(".hint-tools .tool-draw").addEventListener("click", (e) => {
        select_tool("draw");
    });

    document.querySelector(".hint-tools .tool-cluster3").addEventListener("click", (e) => {
        select_tool("cluster3");
    });

    document.querySelector(".hint-tools .tool-cluster5").addEventListener("click", (e) => {
        select_tool("cluster5");
    });

    document.querySelector(".hint-tools .tool-line").addEventListener("click", (e) => {
        select_tool("line");
    });

    document.querySelector(".hint-tools .tool-circle").addEventListener("click", (e) => {
        select_tool("circle");
    });

    document.querySelector(".hint-tools .tool-disc").addEventListener("click", (e) => {
        select_tool("disc");
    });
}

// #endregion

// #region BITS

function get_visual_byte(column, byte, specific_color) {
    let result = 0b0000_0000;
    const offset = byte * 8;
    for( let i = 0; i < 8; i++ ) {
        const num_pixel = offset + i;

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

// #region PIXEL

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
            "L", p2.x, p2.y,
            "L", p3.x, p3.y,
            "L", p4.x, p4.y,
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
            angle_steps : steps,
            pixel_index : i,
            pixel_gap   : 8,
            pixel_len   : 25,
            inner_margin : 80,
            current_angle: a,
        });
        
        pixel.addClass("pixel-" + (i - offset));

        pixel.data("c", count_column); 
        pixel.data("y", (i - offset));
        set_pixel_node(count_column, (i - offset), pixel );

        g.add(pixel);
    }

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

// #region TOOLS / MOUSE

// Tool geometry notes:
// Pixel/cluster tools still work in logical image-space.
// Line/circle tools work in SVG board-space, because a visually straight line on the radial board
// is not a straight line in { column, y } coordinates.
const tool_cluster_radius_3 = 1;
const tool_cluster_radius_5 = 2;
let active_tool = "draw";
let is_painting = false;
let is_erasing = false;
let tool_drag_start = null;
let tool_drag_last = null;
let tool_preview_pixels = [];
let tool_preview_shape = null;

// Keep these matched to the board construction/drawPixel() options.
const tool_pixel_offset = 7;
const tool_pixel_gap = 8;
const tool_pixel_len = 25;
const tool_inner_margin = 80;
const tool_angular_fill = 0.7;

const tool_line_thickness = tool_pixel_len * 0.51; // 0.85
const tool_circle_outline_thickness = tool_pixel_len * 0.51; // 1.10

function pixel_from_event_target(target) {
    if( !target || !target.classList || !target.classList.contains("pixel-hit") ) return( null );

    const node = Snap(target.parentNode);
    return({
        c: parseInt(node.data("c"), 10),
        y: parseInt(node.data("y"), 10),
        node: node,
        target: target
    });
}

function polar_to_xy(r, theta) {
    return({ x: r * Math.cos(theta), y: r * Math.sin(theta) });
}

function pixel_theta(c) {
    return((-Math.PI / 2) + normalized_c(c) * ((2 * Math.PI) / led_columns));
}

function pixel_r_inner(y) {
    return(tool_inner_margin + (y + tool_pixel_offset) * (tool_pixel_len + tool_pixel_gap));
}

function pixel_center_xy(c, y) {
    const theta = pixel_theta(c);
    const r = pixel_r_inner(y) + (tool_pixel_len / 2);
    return(polar_to_xy(r, theta));
}

function pixel_visible_polygon(c, y) {
    const theta = pixel_theta(c);
    const halfWidth = (((2 * Math.PI) / led_columns) * tool_angular_fill) / 2;
    const rInner = pixel_r_inner(y);
    const rOuter = rInner + tool_pixel_len;

    return([
        polar_to_xy(rInner, theta - halfWidth),
        polar_to_xy(rInner, theta + halfWidth),
        polar_to_xy(rOuter, theta + halfWidth),
        polar_to_xy(rOuter, theta - halfWidth)
    ]);
}

function pixel_key(c, y) {
    return( normalized_c(c) + ":" + y );
}

function unique_pixels(points) {
    const seen = new Set();
    const result = [];

    points.forEach((p) => {
        if( p.y < 0 || p.y >= led_rows ) return;

        const c = normalized_c(p.c);
        const key = pixel_key(c, p.y);
        if( seen.has(key) ) return;

        seen.add(key);
        result.push({ c: c, y: p.y });
    });

    return( result );
}

function shortest_column_delta(c1, c2) {
    let delta = normalized_c(c2) - normalized_c(c1);
    if( delta > led_columns / 2 ) delta -= led_columns;
    if( delta < -led_columns / 2 ) delta += led_columns;
    return( delta );
}

function pixels_for_cluster(center, radius) {
    const points = [];

    for( let dc = -radius; dc <= radius; dc++ ) {
        for( let dy = -radius; dy <= radius; dy++ ) {
            if( (dc * dc) + (dy * dy) <= radius * radius ) {
                points.push({ c: center.c + dc, y: center.y + dy });
            }
        }
    }

    return( unique_pixels(points) );
}

function point_in_polygon(point, polygon) {
    let inside = false;

    for( let i = 0, j = polygon.length - 1; i < polygon.length; j = i++ ) {
        const xi = polygon[i].x, yi = polygon[i].y;
        const xj = polygon[j].x, yj = polygon[j].y;

        const intersect = ((yi > point.y) !== (yj > point.y)) &&
            (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);

        if( intersect ) inside = !inside;
    }

    return( inside );
}

function ccw(a, b, c) {
    return((c.y - a.y) * (b.x - a.x) > (b.y - a.y) * (c.x - a.x));
}

function segments_intersect(a, b, c, d) {
    return(ccw(a, c, d) !== ccw(b, c, d) && ccw(a, b, c) !== ccw(a, b, d));
}

function distance_point_to_segment(point, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;

    if( len2 === 0 ) {
        const ex = point.x - a.x;
        const ey = point.y - a.y;
        return(Math.sqrt(ex * ex + ey * ey));
    }

    let t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / len2;
    t = Math.max(0, Math.min(1, t));

    const projected = { x: a.x + t * dx, y: a.y + t * dy };
    const ex = point.x - projected.x;
    const ey = point.y - projected.y;
    return(Math.sqrt(ex * ex + ey * ey));
}

function segment_intersects_polygon(a, b, polygon) {
    if( point_in_polygon(a, polygon) || point_in_polygon(b, polygon) ) return( true );

    for( let i = 0; i < polygon.length; i++ ) {
        const p1 = polygon[i];
        const p2 = polygon[(i + 1) % polygon.length];
        if( segments_intersect(a, b, p1, p2) ) return( true );
    }

    return( false );
}

function circle_intersects_polygon(center, radius, polygon) {
    if( point_in_polygon(center, polygon) ) return( true );

    for( let i = 0; i < polygon.length; i++ ) {
        const p = polygon[i];
        const dx = p.x - center.x;
        const dy = p.y - center.y;
        if( (dx * dx) + (dy * dy) <= radius * radius ) return( true );
    }

    for( let i = 0; i < polygon.length; i++ ) {
        const p1 = polygon[i];
        const p2 = polygon[(i + 1) % polygon.length];
        if( distance_point_to_segment(center, p1, p2) <= radius ) return( true );
    }

    return( false );
}

function pixels_for_screen_line(start, end) {
    const a = tool_point_xy(start);
    const b = tool_point_xy(end);
    const points = [];

    for( let c = 0; c < led_columns; c++ ) {
        for( let y = 0; y < led_rows; y++ ) {
            if( thick_segment_intersects_polygon(a, b, pixel_visible_polygon(c, y), tool_line_thickness) ) {
                points.push({ c: c, y: y });
            }
        }
    }

    return(points);
}

function board_point_from_mouse_event(e) {
    const svg_node = document.querySelector("#svg");
    const pt = svg_node.createSVGPoint();

    pt.x = e.clientX;
    pt.y = e.clientY;

    // Use main, not root svg, because main is the rotated board group.
    return pt.matrixTransform(main.node.getScreenCTM().inverse());
}

function tool_point_xy(point) {
    if( typeof point.x === "number" && typeof point.y === "number" ) {
        return({ x: point.x, y: point.y });
    }

    return pixel_center_xy(point.c, point.y);
}

function point_is_in_center_deadzone(point) {
    const r = Math.sqrt((point.x * point.x) + (point.y * point.y));

    // First drawable row starts here. Anything inside it is the center blank zone.
    return r < pixel_r_inner(0);
}

function circle_outline_intersects_polygon(center, radius, polygon) {
    const half = tool_circle_outline_thickness / 2;

    function distance_from_center(point) {
        const dx = point.x - center.x;
        const dy = point.y - center.y;
        return Math.sqrt((dx * dx) + (dy * dy));
    }

    // Corners near the ring
    for( let i = 0; i < polygon.length; i++ ) {
        if( Math.abs(distance_from_center(polygon[i]) - radius) <= half ) {
            return true;
        }
    }

    // Edge nearest-point near the ring
    for( let i = 0; i < polygon.length; i++ ) {
        const p1 = polygon[i];
        const p2 = polygon[(i + 1) % polygon.length];

        const d = distance_point_to_segment(center, p1, p2);

        if( Math.abs(d - radius) <= half ) {
            return true;
        }
    }

    // Cell center near the ring. This catches lots of visually obvious misses.
    let cx = 0;
    let cy = 0;

    for( let i = 0; i < polygon.length; i++ ) {
        cx += polygon[i].x;
        cy += polygon[i].y;
    }

    cx /= polygon.length;
    cy /= polygon.length;

    if( Math.abs(distance_from_center({ x: cx, y: cy }) - radius) <= half ) {
        return true;
    }

    return false;
}

function pixels_for_screen_circle_outline(start, end) {
    const center = tool_point_xy(start);
    const edge = tool_point_xy(end);

    const dx = edge.x - center.x;
    const dy = edge.y - center.y;
    const radius = Math.sqrt((dx * dx) + (dy * dy));

    const points = [];

    for( let c = 0; c < led_columns; c++ ) {
        for( let y = 0; y < led_rows; y++ ) {
            if( circle_outline_intersects_polygon(center, radius, pixel_visible_polygon(c, y)) ) {
                points.push({ c: c, y: y });
            }
        }
    }

    return(points);
}

function pixels_for_filled_screen_circle(start, end) {
    const center = tool_point_xy(start);
    const edge = tool_point_xy(end);

    const dx = edge.x - center.x;
    const dy = edge.y - center.y;
    const radius = Math.sqrt((dx * dx) + (dy * dy));
    const points = [];

    for( let c = 0; c < led_columns; c++ ) {
        for( let y = 0; y < led_rows; y++ ) {
            const cell_center = pixel_center_xy(c, y);
            const cx = cell_center.x - center.x;
            const cy = cell_center.y - center.y;

            if( (cx * cx) + (cy * cy) <= radius * radius ||
                circle_intersects_polygon(center, radius, pixel_visible_polygon(c, y)) ) {
                points.push({ c: c, y: y });
            }
        }
    }

    return(points);
}

function thick_segment_intersects_polygon(a, b, polygon, thickness) {
    const half = thickness / 2;

    // Exact crossing still counts.
    if( segment_intersects_polygon(a, b, polygon) ) {
        return true;
    }

    // Any polygon corner close enough to the line counts.
    for( let i = 0; i < polygon.length; i++ ) {
        if( distance_point_to_segment(polygon[i], a, b) <= half ) {
            return true;
        }
    }

    // Polygon center close enough to the line counts.
    let cx = 0;
    let cy = 0;

    for( let i = 0; i < polygon.length; i++ ) {
        cx += polygon[i].x;
        cy += polygon[i].y;
    }

    cx /= polygon.length;
    cy /= polygon.length;

    if( distance_point_to_segment({ x: cx, y: cy }, a, b) <= half ) {
        return true;
    }

    return false;
}

function pixels_for_tool_at(point) {
    if( active_tool === "cluster3" ) return( pixels_for_cluster(point, tool_cluster_radius_3) );
    if( active_tool === "cluster5" ) return( pixels_for_cluster(point, tool_cluster_radius_5) );
    return( unique_pixels([{ c: point.c, y: point.y }]) );
}

function pixels_for_drag_tool(start, end) {
    if( active_tool === "line" ) return( pixels_for_screen_line(start, end) );
    if( active_tool === "disc" ) return( pixels_for_filled_screen_circle(start, end) );
    if( active_tool === "circle" ) return( pixels_for_screen_circle_outline(start, end) );
    
    return( pixels_for_tool_at(end) );
}

function repaint_pixel_node(c, y) {
    const node = get_pixel_node(c, y);
    if( !node ) return;

    erase_colors(node);

    const pixel_value = get_pixel(c, y);
    if( pixel_value !== -1 ) {
        node.addClass("painted");
        node.addClass("color" + pixel_value);
    }
}

function apply_tool_pixels(points) {
    points.forEach((p) => {
        if( p.y < 0 || p.y >= led_rows ) return;

        const c = normalized_c(p.c);
        const value = is_erasing ? -1 : current_color;
        set_pixel(c, p.y, value);
        repaint_pixel_node(c, p.y);
    });

    autosave_current_image();
}

function clear_tool_preview_shape() {
    if( tool_preview_shape ) {
        tool_preview_shape.remove();
        tool_preview_shape = null;
    }
}

function show_tool_preview_shape(start, end) {
    clear_tool_preview_shape();

    const a = tool_point_xy(start);
    const b = tool_point_xy(end);

    if( active_tool === "line" ) {
        tool_preview_shape = paper.line(a.x, a.y, b.x, b.y);
    }
    else if( active_tool === "circle" || active_tool === "disc" ) {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        tool_preview_shape = paper.circle(a.x, a.y, Math.sqrt((dx * dx) + (dy * dy)));
    }

    if( tool_preview_shape ) {
        tool_preview_shape.attr({
            class: "tool-preview-shape",
            fill: "none",
            stroke: "#ffffff",
            "stroke-width": 4,
            "stroke-dasharray": "10 8",
            opacity: 0.85,
            "pointer-events": "none"
        });

        // Important: the board rotates by transforming `main`, so preview shapes need to
        // live inside that same group or they will drift visually when the canvas is rotated.
        main.add(tool_preview_shape);
        tool_preview_shape.toFront();
    }
}

function clear_tool_preview() {
    tool_preview_pixels.forEach((p) => {
        const node = get_pixel_node(p.c, p.y);
        if( node ) {
            node.removeClass("tool-preview");
            node.removeClass("tool-preview-erase");
        }
    });
    tool_preview_pixels = [];
    clear_tool_preview_shape();
}

function show_tool_preview(points) {
    tool_preview_pixels.forEach((p) => {
        const node = get_pixel_node(p.c, p.y);
        if( node ) {
            node.removeClass("tool-preview");
            node.removeClass("tool-preview-erase");
        }
    });

    tool_preview_pixels = unique_pixels(points);
    tool_preview_pixels.forEach((p) => {
        const node = get_pixel_node(p.c, p.y);
        if( node ) {
            node.addClass("tool-preview");
            if( is_erasing ) node.addClass("tool-preview-erase");
        }
    });
}

function select_tool(tool_name) {
    active_tool = tool_name;

    document.querySelectorAll(".hint-tools .pressable").forEach((kbd) => {
        kbd.classList.remove("selected");
    });

    const selected = document.querySelector(".hint-tools .tool-" + tool_name);
    if( selected ) selected.classList.add("selected");
}

function finish_tool_drag() {
    if( tool_drag_start !== null && tool_drag_last !== null ) {
        if( active_tool === "line" || active_tool === "circle" || active_tool === "disc") {
            apply_tool_pixels(pixels_for_drag_tool(tool_drag_start, tool_drag_last));
            update_output_code();
        }
    }

    clear_tool_preview();
    tool_drag_start = null;
    tool_drag_last = null;
    is_painting = false;
    is_erasing = false;
    commit_undoable_pixel_edit();
}

function begin_tool_drag(point, shiftKey) {
    begin_undoable_pixel_edit();

    if( shiftKey ) {
        is_erasing = true;
        is_painting = false;
    } else {
        is_painting = true;
        is_erasing = false;
    }

    tool_drag_start = { c: point.c, y: point.y };
    tool_drag_last = { c: point.c, y: point.y };

    if( active_tool === "line" || active_tool === "circle" || active_tool === "disc" ) {
        show_tool_preview_shape(tool_drag_start, tool_drag_last);
        show_tool_preview(pixels_for_drag_tool(tool_drag_start, tool_drag_last));
    } else {
        apply_tool_pixels(pixels_for_tool_at(point));
        update_output_code();
    }
}

function continue_tool_drag(point) {
    if( !is_painting && !is_erasing ) return;

    tool_drag_last = { c: point.c, y: point.y };

    if( active_tool === "line" || active_tool === "circle" || active_tool === "disc" ) {
        show_tool_preview_shape(tool_drag_start, tool_drag_last);
        show_tool_preview(pixels_for_drag_tool(tool_drag_start, tool_drag_last));
    } else {
        apply_tool_pixels(pixels_for_tool_at(point));
        update_output_code();
    }
}

// c, y, num, start
function get_visual_byte_range(c, y) {
    return({
        c: c,
        y: y,
        n: (y >= 32 ? 2 : 8),
        s: (Math.floor(y / 8) * 8)
    });
}

function show_hover_state(e) {
    const point = pixel_from_event_target(e.target);
    if( point === null ) {
        document.querySelector("#tip_left").style.opacity = 0;
        return( null );
    }

    Snap(e.target.nextElementSibling).addClass("mouseover");

    const range = get_visual_byte_range(point.c, point.y);
    for( let i = 0; i < range.n; i++ ) {
        const g_item = get_pixel_node(point.c, range.s + i);
        if( g_item ) g_item[1].addClass("mouseover-byte");
    }

    update_tooltip(e.target);
    return( point );
}

function clear_hover_state(e) {
    const point = pixel_from_event_target(e.target);
    if( point === null ) {
        document.querySelector("#tip_left").style.opacity = 0;
        return;
    }

    Snap(e.target.nextElementSibling).removeClass("mouseover");

    const range = get_visual_byte_range(point.c, point.y);
    for( let i = 0; i < range.n; i++ ) {
        const g_item = get_pixel_node(point.c, range.s + i);
        if( g_item ) g_item[1].removeClass("mouseover-byte");
    }
}

// target must be path.pixel-hit
paper.mousedown(function(e) {
    const point = pixel_from_event_target(e.target);
    if( point === null ) return;

    begin_tool_drag(point, e.shiftKey);
    update_tooltip(e.target);
});

paper.mouseup(function(e) {
    finish_tool_drag();
});

window.addEventListener("mouseup", (e) => {
    finish_tool_drag();
});

paper.mouseover(function(e) {
    const point = show_hover_state(e);
    if( point === null ) return;

    if( e.buttons === 1 ) {
        continue_tool_drag(point);
    }
});

paper.mouseout(function(e) {
    clear_hover_state(e);
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
    if( !confirm("clear image slot # " + get_current_image_index() + " ? this will immediately update localStorage." ) ) {
        return;
    }

    clear_history();
    pixels = blank_pixel_array();
    load_pixel_array(pixels);
    update_output_code();
    autosave_current_image();
}

function action_clear_all() {
    if( !confirm("clear all 8 image slots? this will immediately update localStorage." ) ) {
        return;
    }

    clear_all_history();

    const blank_image = blank_pixel_array();

    for( let i = 0; i < 8; i++ ) {
        save_pixels_to_localstorage(i, blank_image);
    }

    active_image_index = "0";
    document.querySelector("#image_index").value = active_image_index;

    pixels = blank_pixel_array();
    load_pixel_array(pixels);
    reset_editor_tools_to_defaults();
    update_output_code();

    update_image_index_markers();
}

function reset_editor_tools_to_defaults() {
    current_color = 0;
    view_state = 0;
    rotation = 0;
    prev_rotation = 0;
    is_left = false;
    is_right = false;

    select_color(current_color);
    applyViewState();
    applyRotationState();
    save_editor_state_to_localstorage();

    document.querySelector(".hint-rotate .key-a").classList.remove("selected");
    document.querySelector(".hint-rotate .key-d").classList.remove("selected");
}

// #endregion


// #region KEYS

function select_color(color_index) {
    current_color = clamp_number(color_index, 0, 9, 0);

    document.querySelectorAll(".hint-color kbd").forEach( (kbd, index) => {
        kbd.classList.remove("selected");
    });

    const selected_key = document.querySelector(".hint-color .color" + current_color);
    if( selected_key ) selected_key.classList.add("selected");

    localStorage.setItem(storage_color_key, current_color.toString());
}

document.addEventListener("keypress", function(k) {
    if( k.altKey || k.ctrlKey || k.metaKey ) return;

    for( let i = 1; i <= 7; i++ ) {
        if( k.key === i.toString() ) {
            select_color( i-1 );
        }
    }

    if( k.key.toLowerCase() === "v" ) {
        toggleViewKey();
    }
    
    const k2 = k.key.toLowerCase();

    if( k2 === "p" ) {
        select_tool("draw");
    }
    else if( k2 === "b" ) {
        select_tool("cluster3");
    }
    else if( k2 === "g" ) {
        select_tool("cluster5");
    }
    else if( k2 === "l" ) {
        select_tool("line");
    }
    else if( k2 === "c"  ) {
        select_tool("circle");
    }
    else if( k2 === "f" ) {
        select_tool("disc");
    }    
});

document.addEventListener("keydown", function(k) {
    if( k.altKey && !k.ctrlKey && !k.metaKey && !k.shiftKey ) {
        const n = parseInt(k.key, 10);
        if( Number.isInteger(n) && n >= 1 && n <= 8 ) {
            k.preventDefault();
            switch_image_slot(n - 1);
            return;
        }
    }

    if( (k.ctrlKey || k.metaKey) && k.key.toLowerCase() === "z" ) {
        k.preventDefault();
        if( k.shiftKey ) {
            action_redo();
        } else {
            action_undo();
        }
        return;
    }

    if( (k.ctrlKey || k.metaKey) && k.key.toLowerCase() === "y" ) {
        k.preventDefault();
        action_redo();
        return;
    }

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

    if( prev_rotation !== rotation ) {
        main.transform("r" + rotation + ",0,0");
        save_rotation_to_localstorage();
    }
    requestAnimationFrame(do_rotation);
    prev_rotation = rotation;
}

requestAnimationFrame(do_rotation);

function applyViewState() {
    switch( view_state ) {
        case 0:
            paper.attr({ viewBox: "-1500 -1500 3000 1500"});
            document.querySelector(".hint-actions .key-v").classList.add("selected");
        break;

        case 1:
            paper.attr({ viewBox: "-1500 -1500 3000 3000"});
            document.querySelector(".hint-actions .key-v").classList.remove("selected");
        break;
    }
}

function toggleViewKey() {
    view_state++;
    if( view_state > 1 ) view_state = 0;
    applyViewState();

    localStorage.setItem(storage_zoom_key, view_state.toString());
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
}

// If you alt-tab / click away, you might never see keyup:
window.addEventListener("blur", clearKeys);

// If the tab gets backgrounded/foregrounded:
document.addEventListener("visibilitychange", () => {
    if( document.hidden ) clearKeys();
});

// Optional extra safety:
window.addEventListener("focus", clearKeys);

// #endregion