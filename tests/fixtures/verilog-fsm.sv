// Verilog-2005 compatible FSM (for testing with tree-sitter-verilog)
module simple_fsm (
    input  clk,
    input  rst_n,
    input  start,
    input  done,
    output reg busy,
    output reg ready
);

// State encoding
parameter IDLE = 2'b00;
parameter RUN  = 2'b01;
parameter DONE_STATE = 2'b10;

reg [1:0] state, next_state;

// Sequential block
always @(posedge clk or negedge rst_n) begin
    if (!rst_n)
        state <= IDLE;
    else
        state <= next_state;
end

// Combinational block
always @(*) begin
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
            if (done) next_state = DONE_STATE;
        end
        DONE_STATE: begin
            next_state = IDLE;
        end
    endcase
end

endmodule
