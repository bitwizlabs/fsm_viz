// Simple two-block FSM example
module simple_fsm (
    input  logic clk,
    input  logic rst_n,
    input  logic start,
    input  logic done,
    output logic busy,
    output logic ready
);

typedef enum logic [1:0] {IDLE, RUN, DONE} state_t;
state_t state, next_state;

// Sequential block
always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n)
        state <= IDLE;
    else
        state <= next_state;
end

// Combinational block
always_comb begin
    next_state = state;
    busy = 1'b0;
    ready = 1'b0;

    case (state)
        IDLE: begin
            ready = 1'b1;
            if (start) next_state = RUN;
        end
        RUN: begin
            busy = 1'b1;
            if (done) next_state = DONE;
        end
        DONE: begin
            next_state = IDLE;
        end
    endcase
end

endmodule
