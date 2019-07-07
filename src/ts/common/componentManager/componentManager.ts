import { Singleton } from "@eix/utils";
import { Component } from "../component";
import { Subject, BehaviorSubject, fromEvent } from "rxjs";
import { svg, SVGTemplateResult, html } from "lit-html";
import { subscribe } from "lit-rx";
import { Screen } from "../screen.ts";
import { ManagerState, ComponentTemplate } from "./interfaces";
import { Store } from "../store";
import { KeyboardInput } from "@eix/input"
import { success, error } from "toastr"
import { ComponentTemplateStore } from "./componentTemplateStore";
import { alertOptions } from "./alertOptions";
import { WireManager } from "../wires";
import { runCounter } from "../component/runCounter";
import { Settings } from "../store/settings";
import { download } from "./download";
import { modal } from "../modals";
import { map } from "rxjs/operators";
import { persistent } from "../store/persistent";
import { MDCTextField } from '@material/textfield';

const defaultName = "default"


@Singleton
export class ComponentManager {
    public components: Component[] = []
    public svgs = new Subject<SVGTemplateResult>()
    public placeholder = new BehaviorSubject("Create simulation")
    public barAlpha = new BehaviorSubject<string>("0");
    public wireManager = new WireManager()
    public onTop: Component
    public templateStore = new ComponentTemplateStore()

    private temporaryCommnad = ""
    private clicked = false
    private ignoreKeyDowns = false

    private screen = new Screen()
    private settings = new Settings()
    private standard: {
        offset: number
        scale: [number, number]
    } = {
            offset: 50,
            scale: [100, 100]
        }

    private commandHistoryStore = new Store<string>("commandHistory")
    private store = new Store<ManagerState>("simulationStates")

    private saveEvent = new KeyboardInput("s")
    private createEvent = new KeyboardInput("m")
    private closeInputEvent = new KeyboardInput("enter")
    private ctrlEvent = new KeyboardInput("ctrl")
    private palleteEvent = new KeyboardInput("p")
    private undoEvent = new KeyboardInput("z")
    private shiftEvent = new KeyboardInput("shift")
    private refreshEvent = new KeyboardInput("r")
    private clearEvent = new KeyboardInput("delete")
    private upEvent = new KeyboardInput("up")
    private downEvent = new KeyboardInput("down")

    @persistent<ComponentManager, string>(defaultName, "main")
    public name: string
    public alertOptions = alertOptions

    private commandHistory: string[] = []
    private commands: {
        [key: string]: (ctx: ComponentManager, args: string[], flags: string[]) => any
    } = {
            clear(ctx: ComponentManager) {
                ctx.clear()
            },
            save(ctx: ComponentManager) {
                ctx.save()
            },
            ls(ctx: ComponentManager) {
                const data = ctx.store.ls()
                const message = data.join("\n")

                success(message, "", ctx.alertOptions)
            },
            help(ctx: ComponentManager) {
                success(`Usage: &ltcommand> <br>
            Where &ltcommand> is one of:
                <ul>
                ${Object.keys(ctx.commands).map(val => `
                    <li>${val}</li>
                `).join("")}
                </ul>
            `, "", ctx.alertOptions)
            },
            refresh(ctx: ComponentManager) {
                ctx.refresh()
            },
            rewind(ctx:ComponentManager){
                localStorage.clear()
                success("Succesfully cleared localStorage!","",ctx.alertOptions)
            },
            ctp: this.templateStore.commands.template,
            settings: this.settings.commands,
            download
        }
    private inputMode: string

    public gates = this.templateStore.store.lsChanges
    public saves = this.store.lsChanges

    public file: {
        [key: string]: () => void
    } = {
            clear: () => this.clear(),
            clean: () => this.smartClear(),
            save: () => this.save(),
            undo: () => this.refresh(),
            download: () => download(this, [], []),
            delete: () => this.delete(this.name),
            refresh: () => this.silentRefresh(true)
        }

    public shortcuts: {
        [key: string]: string
    } = {
            clear: "shift delete",
            clean: "delete",
            save: "ctrl s",
            undo: "ctrl z",
            refresh: "ctrl r"
        }

    constructor() {
        runCounter.increase()

        this.svgs.next(this.render())

        this.refresh()

        fromEvent(document.body, "keydown").subscribe((e: KeyboardEvent) => {
            if (this.barAlpha.value == "1") {
                const elem = document.getElementById("nameInput")
                elem.focus()
            }
            else if (!this.ignoreKeyDowns) {
                e.preventDefault()
            }
        })

        fromEvent(document.body, "keyup").subscribe((e: MouseEvent) => {
            if (this.barAlpha.value === "1") {
                if (this.closeInputEvent.value)
                    this.create()
                else if (this.inputMode === "command") {
                    const elem = <HTMLInputElement>document.getElementById("nameInput")
                    if (this.upEvent.value) {
                        document.body.focus()
                        e.preventDefault()
                        const index = this.commandHistory.indexOf(elem.value)

                        if (index) {
                            //save drafts
                            if (index === -1)
                                this.temporaryCommnad = elem.value

                            const newIndex = (index === -1) ? this.commandHistory.length - 1 : index - 1
                            elem.value = this.commandHistory[newIndex]
                        }
                    }
                    if (this.downEvent.value) {
                        document.body.focus()
                        e.preventDefault()
                        const index = this.commandHistory.indexOf(elem.value)

                        if (index > -1) {
                            const maxIndex = this.commandHistory.length - 1
                            elem.value = (index === maxIndex) ? this.temporaryCommnad : this.commandHistory[index + 1]
                        }
                    }
                }
            }
            else {
                if (this.ctrlEvent.value) {
                    if (this.createEvent.value) {
                        this.prepareNewSimulation()
                    }
                    else if (this.shiftEvent.value && this.palleteEvent.value) {
                        this.preInput()
                        this.inputMode = "command"
                        this.placeholder.next("Command palette")
                    }
                    else if (this.saveEvent.value) {
                        this.save()
                    }
                    else if (this.undoEvent.value) {
                        this.refresh()
                    }
                    else if (this.refreshEvent.value) {
                        this.silentRefresh(true)
                    }
                }
                else if (this.clearEvent.value) {
                    if (this.shiftEvent.value)
                        this.clear()
                    else
                        this.smartClear()
                }
            }
        })

        this.wireManager.update.subscribe(() => {
            // this.save()
            this.update()
            // this.save()
        })
        if (this.saves.value.length === 0)
            this.save()

    }

    private initEmptyGate(name: string) {
        const obj: ComponentTemplate = {
            inputs: 1,
            name,
            version: "1.0.0",
            outputs: 1,
            activation: "",
            editable: true,
            material: {
                mode: "color",
                data: "blue"
            }
        }

        this.templateStore.store.set(name, obj)

        this.edit(name)
    }

    public newGate() {
        this.preInput()
        this.inputMode = "gate"
        this.placeholder.next("Gate name")
    }

    public prepareNewSimulation() {
        this.preInput()
        this.inputMode = "create"
        this.placeholder.next("Create simulation")
    }

    private preInput() {
        const elem = <HTMLInputElement>document.getElementById("nameInput")
        elem.value = ""
        this.barAlpha.next("1")
    }

    private async create() {
        const elem = <HTMLInputElement>document.getElementById("nameInput")
        this.barAlpha.next("0")

        if (this.inputMode === "create") {
            await this.createEmptySimulation(elem.value)
            success(`Succesfully created simulation ${elem.value}`, "", this.alertOptions)
        }

        else if (this.inputMode === "command")
            this.eval(elem.value)

        else if (this.inputMode === "gate")
            this.initEmptyGate(elem.value)
    }

    private async handleDuplicateModal(name: string) {
        const result = await modal({
            title: "Warning",
            content: html`There was already a simulation called ${name},
            are you sure you want to override it?
            All your work will be lost!`
        })

        return result
    }

    public async edit(name: string) {
        this.ignoreKeyDowns = true
        const gate = this.templateStore.store.get(name)

        modal({
            no: "",
            yes: "save",
            title: `Edit ${name}`,
            content: html`${html`
                <br>
                <div class="mdc-text-field mdc-text-field--textarea">
                    <textarea id="codeArea" class="mdc-text-field__input js" rows="8" cols="40">${
                gate.activation
                }</textarea>
                    <div class="mdc-notched-outline">
                        <div class="mdc-notched-outline__leading"></div>
                        <div class="mdc-notched-outline__notch">
                        <label for="textarea" class="mdc-floating-label">Activation function</label>
                        </div>
                        <div class="mdc-notched-outline__trailing"></div>
                    </div>
                </div><br><br>
                <div class="mdc-text-field" id="inputCount">
                    <input type="number" id="my-text-field" class="mdc-text-field__input inputCount-i" value=${gate.inputs}>
                    <label class="mdc-floating-label" for="my-text-field">Inputs</label>
                    <div class="mdc-line-ripple"></div>
                </div><br><br>
                <div class="mdc-text-field" id="outputCount">
                    <input type="number" id="my-text-field" class="mdc-text-field__input outputCount-i" value=${gate.outputs}>
                    <label class="mdc-floating-label" for="my-text-field">Outputs</label>
                    <div class="mdc-line-ripple"></div>
                </div><br><br>
                <div class="mdc-text-field" id="color">
                    <input type="string" id="my-text-field" class="mdc-text-field__input color-i" value=${gate.material.data}>
                    <label class="mdc-floating-label" for="my-text-field">Outputs</label>
                    <div class="mdc-line-ripple"></div>
                </div><br>
            `}`
        }).then(val => {
            this.ignoreKeyDowns = false
            const elems: (HTMLInputElement | HTMLTextAreaElement)[] = [
                document.querySelector("#codeArea"),
                document.querySelector(".inputCount-i"),
                document.querySelector(".outputCount-i"),
                document.querySelector(".color-i")
            ]
            const data = elems.map(val => val.value)

            this.templateStore.store.set(name, {
                ...gate,
                activation: data[0],
                inputs: Number(data[1]),
                outputs: Number(data[2]),
                material:{
                    mode: "color",
                    data: data[3]
                }
            })
        })

        new MDCTextField(document.querySelector('.mdc-text-field'));
        new MDCTextField(document.querySelector('#outputCount'));
        new MDCTextField(document.querySelector('#inputCount'));
        new MDCTextField(document.querySelector('#color'));
    }

    public add(template: string, position?: [number, number]) {
        const pos = position ? position : [...Array(2)].fill(this.standard.offset * this.components.length) as [number, number]

        this.components.push(new Component(template, pos, this.standard.scale))
        this.update()
    }

    public async delete(name: string) {
        const res = await modal({
            title: "Are you sure?",
            content: html`Deleting a simulations is ireversible, and all work will be lost!`
        })

        if (res) {
            if (this.name === name) {
                if (this.saves.value.length > 1) {
                    this.switchTo(this.saves.value.find(val => val !== name))
                }
                else {
                    let newName = (name === defaultName) ? `${defaultName}(1)` : defaultName
                    await this.createEmptySimulation(newName)
                    this.switchTo(newName)
                }
            }
            this.store.delete(name)
        }
    }

    public createEmptySimulation(name: string) {
        const create = () => {
            this.store.set(name, {
                wires: [],
                components: [],
                position: [0, 0],
                scale: [1, 1]
            })

            if (name !== this.name)
                this.save()
            this.name = name
            this.refresh()
        }

        return new Promise(async (res) => {//get wheater theres already a simulation with that name
            if (this.store.get(name) && await this.handleDuplicateModal(name) ||
                !this.store.get(name)) {
                create()
                res(true)
            }
        })
    }

    public switchTo(name: string) {
        const data = this.store.get(name)
        if (!data)
            error(`An error occured when trying to load ${name}`, "", this.alertOptions)

        this.name = name
        this.refresh()
    }

    eval(command: string) {
        if (!this.commandHistory.includes(command)) // no duplicates
            this.commandHistory.push(command)

        while (this.commandHistory.length > 10) // max of 10 elements
            this.commandHistory.shift()

        const words = command.split(" ")

        if (words[0] in this.commands) {
            const remaining = words.slice(1)
            const flags = remaining.filter(val => val[0] == "-")
            const args = remaining.filter(val => val[0] != "-")
            this.commands[words[0]](this, args, flags)
        }
        else
            error(`Command ${words} doesn't exist. Run help to get a list of all commands.`,
                "", this.alertOptions)
    }

    public smartClear() {
        this.components = this.components.filter(({ id }) =>
            this.wireManager.wires.find(val => val.input.of.id == id || val.output.of.id == id)
        )
        this.update()
        success("Succesfully cleared all unconnected components", "", this.alertOptions)
    }

    public clear() {
        this.components = []
        this.wireManager.dispose()
        this.update()

        success("Succesfully cleared all components", "", this.alertOptions)
    }

    public refresh() {
        if (this.store.get(this.name)) {
            this.loadState(this.store.get(this.name))
        }

        for (const i of this.commandHistoryStore.ls())
            this.commandHistory[Number(i)] = this.commandHistoryStore.get(i)

        this.update()

        success("Succesfully refreshed to the latest save", "", this.alertOptions)
    }

    update() {
        this.svgs.next(this.render())
    }

    handleMouseDown() {
        this.clicked = true
    }

    handleMouseUp() {
        this.clicked = false
    }

    handleMouseMove(e: MouseEvent) {
        if (e.button === 0) {
            let toAddOnTop: number
            let outsideComponents = true

            for (let i = 0; i < this.components.length; i++) {
                const component = this.components[i]
                if (component.clicked) {
                    outsideComponents = false
                    component.move(e)
                    if (this.onTop != component) {
                        toAddOnTop = i
                    }
                }
            }

            // if (false) { }
            if (toAddOnTop >= 0) {
                this.top(this.components[toAddOnTop])
            }

            else if (outsideComponents && this.clicked) {
                const mousePosition = [e.clientX, e.clientY]
                const delta = mousePosition.map((value, index) =>
                    this.screen.mousePosition[index] - value
                ) as [number, number]
                this.screen.move(...delta)
            }
        }
    }

    public silentRefresh(verboose = false) {
        this.loadState(this.state)
        if (verboose)
            success("Succesfully reloaded all components", "", this.alertOptions)
    }

    public top(component: Component) {
        if (this.onTop !== component) {
            this.onTop = component
            this.components.push(component)
        }
        this.update()
    }

    private render() {
        let toRemoveDuplicatesFor: Component

        const result = this.components.map(component => {
            const mouseupHandler = () => {
                component.handleMouseUp()
                toRemoveDuplicatesFor = component
            }

            const stroke = subscribe(component.clickedChanges.pipe(map(
                val => val ? "yellow" : "black"
            )))

            return svg`
            <g>
                ${component.pinsSvg(10, 20)}
                ${component.pinsSvg(10, 20, "output")}

                <g @mousedown=${ (e: MouseEvent) => component.handleClick(e)}
                    @touchstart=${(e: MouseEvent) => component.handleClick(e)}
                    @mouseup=${mouseupHandler}
                    @touchend=${mouseupHandler}>
                    <rect width=${ subscribe(component.width)}
                    height=${ subscribe(component.height)}
                    x=${ subscribe(component.x)}
                    y=${ subscribe(component.y)}
                    stroke=${stroke}
                    fill=${(component.material.mode === "standard_image") ?
                    "rgba(0,0,0,0)" :
                    subscribe(component.material.color)}
                    rx=20
                    ry=20>
                </rect>
                ${(component.material.mode === "standard_image") ? component.material.innerHTML(
                        subscribe(component.x),
                        subscribe(component.y),
                        subscribe(component.width),
                        subscribe(component.height)) : ""}
                </g>
            </g>
        `});

        if (toRemoveDuplicatesFor)
            this.removeDuplicates(toRemoveDuplicatesFor)

        return svg`${this.wireManager.svg} ${result}`
    }

    private removeDuplicates(component: Component) {
        let instances = this.components
            .map((value, index) => (value == component) ? index : null)
            .filter(value => value)
        instances.pop()

        this.components = this.components
            .filter((_, index) => instances.indexOf(index) != -1)
    }

    get state(): ManagerState {
        const components = Array.from((new Set(this.components)).values())
        return {
            components: components.map(value => value.state),
            position: this.screen.position as [number, number],
            scale: this.screen.scale as [number, number],
            wires: this.wireManager.state
        }
    }

    get scaling(): Component {
        return this.components.find(val => val.scaling)
    }

    public getComponentById(id: number) {
        return this.components.find(val => val.id === id)
    }

    private loadState(state: ManagerState) {
        if (!state.wires) //old state
            return

        this.wireManager.dispose()
        this.clicked = false
        this.components = state.components.map(value => Component.fromState(value))
        this.onTop = null

        state.wires.forEach(val => {
            this.wireManager.start = this.getComponentById(val.from.owner).outputPins[val.from.index]
            this.wireManager.end = this.getComponentById(val.to.owner).inputPins[val.to.index]
            this.wireManager.tryResolving()
        })

        this.screen.scale = state.scale
        this.screen.position = state.position
        this.screen.update()

        this.update()
    }

    save() {
        for (let i = 0; i < this.commandHistory.length; i++) {
            const element = this.commandHistory[i];
            this.commandHistoryStore.set(i.toString(), element)
        }
        this.store.set(this.name, this.state)
        success(`Saved the simulation ${this.name} succesfully!`, "", this.alertOptions)
    }
}